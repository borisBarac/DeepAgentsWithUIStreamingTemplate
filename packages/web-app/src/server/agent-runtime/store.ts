import type { ExecutionIdentity, RunMetadata, SessionRecord, SessionStore } from "./types.ts";

const MAX_SESSIONS = 100;

function sessionKey(identity: ExecutionIdentity, sessionId: string): string {
  return `${identity.tenantId}\u0000${identity.userId}\u0000${sessionId}`;
}

type InMemoryEntry = {
  record: SessionRecord;
  version: number;
};

export class InMemorySessionStore implements SessionStore {
  readonly #sessions = new Map<string, InMemoryEntry>();
  readonly #runs = new Map<string, RunMetadata>();

  async loadSession(identity: ExecutionIdentity, sessionId: string) {
    const key = sessionKey(identity, sessionId);
    const entry = this.#sessions.get(key);
    if (!entry) return { record: null, version: 0 };
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
      this.#runs.delete(oldest);
    }
    return true;
  }

  async recordRun(identity: ExecutionIdentity, sessionId: string, metadata: RunMetadata) {
    const key = sessionKey(identity, sessionId);
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
