import type { Redis } from "ioredis";
import type { ExecutionIdentity } from "../agent-runtime/types.ts";
import { RedisCodec, RUN_STATE_SCHEMA_VERSION, type RunStateRecord } from "./codec.ts";
import { createRedisKeys, type RedisKeyspaces, resolveTtlConfig, type TtlConfig } from "./keys.ts";

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
      this.#keys.runState(record.runId, record.identity),
      codec.encode({ ...record, status: "queued" }),
      "EX",
      await this.#remainingTtl(this.#keys.runState(record.runId, record.identity)),
    );
  }

  async recordRunning(runId: string, identity?: ExecutionIdentity): Promise<void> {
    await this.#merge(runId, { status: "running" }, identity);
  }

  async recordCompleted(
    runId: string,
    failureMessage?: string,
    identity?: ExecutionIdentity,
  ): Promise<void> {
    const patch: RunStatePatch = {
      finishedAt: Date.now(),
      status: "completed",
    };
    if (failureMessage !== undefined) patch.failureMessage = failureMessage;
    await this.#merge(runId, patch, identity);
  }

  async recordFailed(
    runId: string,
    failureMessage?: string,
    identity?: ExecutionIdentity,
  ): Promise<void> {
    const patch: RunStatePatch = {
      finishedAt: Date.now(),
      status: "failed",
    };
    if (failureMessage !== undefined) patch.failureMessage = failureMessage;
    await this.#merge(runId, patch, identity);
  }

  async recordCancelled(runId: string, identity?: ExecutionIdentity): Promise<void> {
    await this.#merge(runId, { finishedAt: Date.now(), status: "cancelled" }, identity);
  }

  async get(runId: string, identity?: ExecutionIdentity): Promise<RunStateRecord | null> {
    const raw = await this.#client.get(this.#keys.runState(runId, identity));
    return codec.decode(raw);
  }

  async #merge(runId: string, patch: RunStatePatch, identity?: ExecutionIdentity): Promise<void> {
    const key = this.#keys.runState(runId, identity);
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
    await this.#client.set(key, codec.encode(merged), "EX", await this.#remainingTtl(key));
  }

  async #remainingTtl(key: string): Promise<number> {
    const pttl = await this.#client.pttl(key);
    return pttl > 0 ? Math.max(1, Math.ceil(pttl / 1_000)) : this.#ttl.runState;
  }
}
