import type { Redis } from "ioredis";

import { createRedisKeys, type RedisKeyspaces, resolveTtlConfig, type TtlConfig } from "./keys.ts";

// Per-run cancellation flag. On client disconnect the API sets the flag; the
// worker polls between streamed events and aborts the active interaction. The
// flag TTL bounds memory so an abandoned run's flag eventually disappears.
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

  // Mark a run as cancelled. Idempotent.
  async cancel(runId: string): Promise<void> {
    await this.#client.set(this.#keys.cancellation(runId), "1", "EX", this.#ttl.cancellation);
  }

  async isCancelled(runId: string): Promise<boolean> {
    const value = await this.#client.get(this.#keys.cancellation(runId));
    return value === "1";
  }

  async clear(runId: string): Promise<void> {
    await this.#client.del(this.#keys.cancellation(runId));
  }

  // Polls the cancellation flag at the configured interval. Resolves true when
  // the run is cancelled, or false when the abort signal fires first.
  async watch(runId: string, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return false;
    while (true) {
      if (await this.isCancelled(runId)) return true;
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
