import type { ExecutionIdentity, RunMetadata, SessionRecord, SessionStore } from "./types.ts";

// GUEST SESSION STORE — VOLATILE BY DESIGN
// ----------------------------------------
// This is the in-process adapter. It is acceptable for the anonymous-guest
// model and for unit tests; production uses RedisSessionStore when REDIS_URL is
// set. Be aware of the limits before relying on it:
//
//   1. LOST ON RESTART. Anything in #sessions/#runs disappears when the web
//      app process exits or is replaced.
//   2. NOT SHARED ACROSS INSTANCES. Behind a load balancer, each instance
//      keeps its own store.
//   3. LRU-BOUNDED AT 100. Both #sessions and #runs evict independently when
//      they exceed MAX_SESSIONS.
//
// The async protocol mirrors the Redis adapter so call sites are agnostic.
const MAX_SESSIONS = 100;

function sessionKey(identity: ExecutionIdentity, sessionId: string): string {
  return `${identity.tenantId}\u0000${identity.userId}\u0000${sessionId}`;
}

type InMemoryEntry = {
  record: SessionRecord;
  version: number;
};

// Local in-process adapter for SessionStore. Session state is keyed by the
// full (tenant, user, session) tuple. Per-instance LRU-bounded. The version
// counter increments on each commit so optimistic-concurrency callers behave
// the same as they do against Redis.
export class InMemorySessionStore implements SessionStore {
  readonly #sessions = new Map<string, InMemoryEntry>();
  readonly #runs = new Map<string, RunMetadata>();

  async loadSession(identity: ExecutionIdentity, sessionId: string) {
    const key = sessionKey(identity, sessionId);
    const entry = this.#sessions.get(key);
    if (!entry) return { record: null, version: 0 };
    // Refresh recency (LRU).
    this.#sessions.delete(key);
    this.#sessions.set(key, entry);
    return { record: entry.record, version: entry.version };
  }

  async commitSession(
    identity: ExecutionIdentity,
    sessionId: string,
    record: SessionRecord,
    expectedVersion: number,
  ): Promise<boolean> {
    const key = sessionKey(identity, sessionId);
    const existing = this.#sessions.get(key);
    if (existing && existing.version !== expectedVersion) return false;
    const nextVersion = (existing?.version ?? 0) + 1;
    this.#sessions.delete(key);
    this.#sessions.set(key, { record, version: nextVersion });
    while (this.#sessions.size > MAX_SESSIONS) {
      const oldest = this.#sessions.keys().next().value;
      if (oldest === undefined) break;
      this.#sessions.delete(oldest);
      // Drop the matching run metadata so #runs cannot retain entries for
      // sessions that no longer exist.
      this.#runs.delete(oldest);
    }
    return true;
  }

  async recordRun(identity: ExecutionIdentity, sessionId: string, metadata: RunMetadata) {
    const key = sessionKey(identity, sessionId);
    // Refresh recency (LRU). recordRun is the only writer on the cancel/error
    // path (commitSession is skipped), so #runs must bound itself here -
    // otherwise a sustained run of failures would grow #runs without limit.
    this.#runs.delete(key);
    this.#runs.set(key, metadata);
    while (this.#runs.size > MAX_SESSIONS) {
      const oldest = this.#runs.keys().next().value;
      if (oldest === undefined) break;
      this.#runs.delete(oldest);
    }
  }

  async lastRun(identity: ExecutionIdentity, sessionId: string): Promise<RunMetadata | null> {
    return this.#runs.get(sessionKey(identity, sessionId)) ?? null;
  }
}
