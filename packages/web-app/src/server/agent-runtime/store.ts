import type { ExecutionIdentity, RunMetadata, SessionRecord, SessionStore } from "./types.ts";

export type { SessionStore } from "./types.ts";

// GUEST SESSION STORE — VOLATILE BY DESIGN
// ----------------------------------------
// This is the only session store today. It lives in-process and is acceptable
// for the anonymous-guest model (every user is a guest; no authentication; no
// promise of continuity). Be aware of the limits before relying on it:
//
//   1. LOST ON RESTART. Anything in #sessions/#runs disappears when the web
//      app process exits or is replaced. Guests get a fresh conversation on
//      the next turn after a restart.
//   2. NOT SHARED ACROSS INSTANCES. Behind a load balancer, each instance
//      keeps its own store, so a guest's next request may hit a different
//      instance and look like a new session. Sticky sessions would mitigate
//      this; a real durable backend is the proper fix.
//   3. LRU-BOUNDED AT 100. Both #sessions and #runs evict independently when
//      they exceed MAX_SESSIONS. This matters on the cancel/error path where
//      a run is recorded without a session commit — without the independent
//      bound, #runs would grow unboundedly under sustained failures.
//
// When continuity across restarts / instances is required, replace this with
// a durable backend (Redis or a DB) implementing SessionStore. See
// DeepAgentTemplate-ykgj.
const MAX_SESSIONS = 100;

function sessionKey(identity: ExecutionIdentity, sessionId: string): string {
  return `${identity.tenantId}\u0000${identity.userId}\u0000${sessionId}`;
}

// Local in-process adapter for SessionStore. Session state is keyed by the
// full (tenant, user, session) tuple so two guests never collide even if they
// happen to choose the same sessionId. Per-instance LRU-bounded.
export class InMemorySessionStore implements SessionStore {
  readonly #sessions = new Map<string, SessionRecord>();
  readonly #runs = new Map<string, RunMetadata>();

  loadSession(identity: ExecutionIdentity, sessionId: string): SessionRecord | null {
    const key = sessionKey(identity, sessionId);
    const record = this.#sessions.get(key);
    if (!record) return null;
    // Refresh recency (LRU).
    this.#sessions.delete(key);
    this.#sessions.set(key, record);
    return record;
  }

  commitSession(identity: ExecutionIdentity, sessionId: string, record: SessionRecord): void {
    const key = sessionKey(identity, sessionId);
    this.#sessions.delete(key);
    this.#sessions.set(key, record);
    while (this.#sessions.size > MAX_SESSIONS) {
      const oldest = this.#sessions.keys().next().value;
      if (oldest === undefined) break;
      this.#sessions.delete(oldest);
      // Drop the matching run metadata so #runs cannot retain entries for
      // sessions that no longer exist.
      this.#runs.delete(oldest);
    }
  }

  recordRun(identity: ExecutionIdentity, sessionId: string, metadata: RunMetadata): void {
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

  lastRun(identity: ExecutionIdentity, sessionId: string): RunMetadata | null {
    return this.#runs.get(sessionKey(identity, sessionId)) ?? null;
  }
}

// Reserved configuration for the future Redis-backed SessionStore. The
// constructor accepts this without connecting to Redis; every method throws
// until the implementation lands behind the SessionStore protocol.
export type RedisSessionStoreOptions = {
  url?: string;
  keyPrefix?: string;
  ttlSeconds?: number;
};

const REDIS_SESSION_STORE_NOT_IMPLEMENTED = "RedisSessionStore is not implemented yet.";

// Placeholder for the future Redis-backed session store. Constructed with
// reserved configuration so call sites can wire the type now; every method
// throws a clear not-implemented error. No Redis dependency, connection
// management, serialization, TTL, or migration is added yet.
export class RedisSessionStore implements SessionStore {
  constructor(readonly options: RedisSessionStoreOptions = {}) {}

  loadSession(_identity: ExecutionIdentity, _sessionId: string): SessionRecord | null {
    throw new Error(REDIS_SESSION_STORE_NOT_IMPLEMENTED);
  }

  commitSession(_identity: ExecutionIdentity, _sessionId: string, _record: SessionRecord): void {
    throw new Error(REDIS_SESSION_STORE_NOT_IMPLEMENTED);
  }

  recordRun(_identity: ExecutionIdentity, _sessionId: string, _metadata: RunMetadata): void {
    throw new Error(REDIS_SESSION_STORE_NOT_IMPLEMENTED);
  }

  lastRun(_identity: ExecutionIdentity, _sessionId: string): RunMetadata | null {
    throw new Error(REDIS_SESSION_STORE_NOT_IMPLEMENTED);
  }
}
