import type { Redis } from "ioredis";
import type { ExecutionIdentity } from "../agent-runtime/types.ts";

import { createRedisKeys, type RedisKeyspaces, resolveTtlConfig, type TtlConfig } from "./keys.ts";

export type RedisCancellationOptions = {
  readonly client: Redis;
  readonly keyPrefix: string;
  readonly ttl?: TtlConfig;
  readonly pollIntervalMs?: number;
};

const DEFAULT_POLL_INTERVAL_MS = 500;

export class RedisCancellation {
  readonly #client: Redis;
  readonly #keys: RedisKeyspaces;
  readonly #ttl: ReturnType<typeof resolveTtlConfig>;
  readonly #pollIntervalMs: number;

  constructor(options: RedisCancellationOptions) {
    this.#client = options.client;
    this.#keys = createRedisKeys(options.keyPrefix);
    this.#ttl = resolveTtlConfig(options.ttl);
    this.#pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  async cancel(runId: string): Promise<void>;
  async cancel(identity: ExecutionIdentity, runId: string): Promise<void>;
  async cancel(first: string | ExecutionIdentity, second?: string): Promise<void> {
    const identity = typeof first === "string" ? undefined : first;
    const runId = typeof first === "string" ? first : second;
    if (!runId) throw new Error("runId is required.");
    const key = this.#keys.cancellation(runId, identity);
    await (this.#client.set as unknown as (...args: unknown[]) => Promise<unknown>)(
      key,
      "1",
      "EX",
      this.#ttl.cancellation,
      "NX",
    );
  }

  async isCancelled(runId: string): Promise<boolean>;
  async isCancelled(identity: ExecutionIdentity, runId: string): Promise<boolean>;
  async isCancelled(first: string | ExecutionIdentity, second?: string): Promise<boolean> {
    const identity = typeof first === "string" ? undefined : first;
    const runId = typeof first === "string" ? first : second;
    if (!runId) throw new Error("runId is required.");
    const value = await this.#client.get(
      identity ? this.#keys.cancellation(runId, identity) : this.#keys.cancellation(runId),
    );
    return value === "1";
  }

  async clear(runId: string): Promise<void>;
  async clear(identity: ExecutionIdentity, runId: string): Promise<void>;
  async clear(first: string | ExecutionIdentity, second?: string): Promise<void> {
    const identity = typeof first === "string" ? undefined : first;
    const runId = typeof first === "string" ? first : second;
    if (!runId) throw new Error("runId is required.");
    await this.#client.del(
      identity ? this.#keys.cancellation(runId, identity) : this.#keys.cancellation(runId),
    );
  }

  async watch(runId: string, signal: AbortSignal): Promise<boolean>;
  async watch(identity: ExecutionIdentity, runId: string, signal: AbortSignal): Promise<boolean>;
  async watch(
    first: string | ExecutionIdentity,
    second: string | AbortSignal,
    third?: AbortSignal,
  ): Promise<boolean> {
    const identity = typeof first === "string" ? undefined : first;
    const runId = typeof first === "string" ? first : second;
    const signal = typeof first === "string" ? (second as AbortSignal) : third;
    if (typeof runId !== "string" || !signal) throw new Error("runId and signal are required.");
    if (signal.aborted) return false;
    while (true) {
      if (await (identity ? this.isCancelled(identity, runId) : this.isCancelled(runId)))
        return true;
      if (signal.aborted) return false;
      await sleep(this.#pollIntervalMs, signal);
      if (signal.aborted) return false;
    }
  }

  get pollIntervalMs(): number {
    return this.#pollIntervalMs;
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
