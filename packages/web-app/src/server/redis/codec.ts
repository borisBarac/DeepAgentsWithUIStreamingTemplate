export type EncodedRecord<T> = {
  readonly v: number;
  readonly payload: T;
};

export class RedisCodec<T> {
  readonly schemaVersion: number;

  constructor(schemaVersion: number) {
    this.schemaVersion = schemaVersion;
  }

  encode(payload: T): string {
    return JSON.stringify({ payload, v: this.schemaVersion } satisfies EncodedRecord<T>);
  }

  decode(raw: string | null): T | null {
    if (raw === null || raw === undefined) return null;
    try {
      const parsed = JSON.parse(raw) as EncodedRecord<T>;
      if (!parsed || typeof parsed !== "object") return null;
      if (parsed.v !== this.schemaVersion) {
        throw new Error(
          `Unsupported schema version: got ${parsed.v}, expected ${this.schemaVersion}.`,
        );
      }
      return parsed.payload;
    } catch (error) {
      if (error instanceof SyntaxError) return null;
      throw error;
    }
  }
}

export const SESSION_RECORD_SCHEMA_VERSION = 1;
export const RUN_METADATA_SCHEMA_VERSION = 1;
export const RUN_STATE_SCHEMA_VERSION = 1;
export const LOCK_SCHEMA_VERSION = 1;

export type RunStateRecord = {
  readonly runId: string;
  readonly identity: { readonly tenantId: string; readonly userId: string };
  readonly sessionId: string;
  readonly status: "queued" | "running" | "completed" | "failed" | "cancelled";
  readonly startedAt: number;
  readonly finishedAt?: number;
  readonly failureMessage?: string;
};

export type SessionLockRecord = {
  readonly runId: string;
  readonly fencingToken: number;
  readonly acquiredAt: number;
  readonly identity: { readonly tenantId: string; readonly userId: string };
  readonly sessionId: string;
};
