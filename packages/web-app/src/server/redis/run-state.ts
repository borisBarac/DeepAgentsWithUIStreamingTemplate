import type { Redis } from "ioredis";

import { RedisCodec, RUN_STATE_SCHEMA_VERSION, type RunStateRecord } from "./codec.ts";
import { createRedisKeys, type RedisKeyspaces, resolveTtlConfig, type TtlConfig } from "./keys.ts";

// Mutable mirror of RunStateRecord used for partial patches inside the merge
// function. RunStateRecord itself is readonly; this type lets us construct
// patches without an explosive list of optional fields.
type RunStatePatch = {
  status?: RunStateRecord["status"];
  finishedAt?: number;
  failureMessage?: string;
};

const codec = new RedisCodec<RunStateRecord>(RUN_STATE_SCHEMA_VERSION);

export type RedisRunStateStoreOptions = {
  readonly client: Redis;
  readonly keyPrefix: string;
  readonly ttl?: TtlConfig;
};

// Tracks per-run lifecycle state in Redis. Workers update it as the run
// progresses; the API reads it to detect lost/finished runs. State keys TTL
// out shortly after the run completes so completed runs are not retained
// indefinitely.
export class RedisRunStateStore {
  readonly #client: Redis;
  readonly #keys: RedisKeyspaces;
  readonly #ttl: ReturnType<typeof resolveTtlConfig>;

  constructor(options: RedisRunStateStoreOptions) {
    this.#client = options.client;
    this.#keys = createRedisKeys(options.keyPrefix);
    this.#ttl = resolveTtlConfig(options.ttl);
  }

  async recordQueued(record: RunStateRecord): Promise<void> {
    await this.#client.set(
      this.#keys.runState(record.runId),
      codec.encode({ ...record, status: "queued" }),
      "EX",
      this.#ttl.runState,
    );
  }

  async recordRunning(runId: string): Promise<void> {
    await this.#merge(runId, { status: "running" });
  }

  async recordCompleted(runId: string, failureMessage?: string): Promise<void> {
    const patch: RunStatePatch = {
      finishedAt: Date.now(),
      status: "completed",
    };
    if (failureMessage !== undefined) patch.failureMessage = failureMessage;
    await this.#merge(runId, patch);
  }

  async recordFailed(runId: string, failureMessage?: string): Promise<void> {
    const patch: RunStatePatch = {
      finishedAt: Date.now(),
      status: "failed",
    };
    if (failureMessage !== undefined) patch.failureMessage = failureMessage;
    await this.#merge(runId, patch);
  }

  async recordCancelled(runId: string): Promise<void> {
    await this.#merge(runId, { finishedAt: Date.now(), status: "cancelled" });
  }

  async get(runId: string): Promise<RunStateRecord | null> {
    const raw = await this.#client.get(this.#keys.runState(runId));
    return codec.decode(raw);
  }

  async #merge(runId: string, patch: RunStatePatch): Promise<void> {
    const key = this.#keys.runState(runId);
    const existing = codec.decode(await this.#client.get(key));
    if (!existing) {
      throw new Error(
        `Run state for ${runId} cannot transition to "${patch.status}" before "queued"`,
      );
    }
    const base: RunStateRecord = existing;
    const merged: RunStateRecord = {
      finishedAt: patch.finishedAt ?? base.finishedAt,
      identity: base.identity,
      runId: base.runId,
      sessionId: base.sessionId,
      startedAt: base.startedAt,
      status: patch.status ?? base.status,
      ...(patch.failureMessage !== undefined
        ? { failureMessage: patch.failureMessage }
        : "failureMessage" in base
          ? { failureMessage: base.failureMessage }
          : {}),
    };
    await this.#client.set(key, codec.encode(merged), "EX", this.#ttl.runState);
  }
}
