import type Redis from "ioredis";

// Shared Redis connection layer. One ioredis instance is shared by the API and
// worker processes for everything EXCEPT BullMQ's blocking reads (BullMQ
// reserves a dedicated connection for `brpoplpush`/`bzpopmin`). Callers should
// reach for {@link getSharedRedis} for normal commands and
// {@link getBullMqRedis} for the BullMQ constructor's `connection` option.
//
// REDIS_URL is REQUIRED for Redis-backed production mode. The shared client is
// created lazily on first call so tests that never touch Redis pay no cost.

export type ResolvedRedisOptions = {
  readonly url: string;
  readonly keyPrefix: string;
};

export function resolveRedisOptions(env: NodeJS.ProcessEnv = process.env): ResolvedRedisOptions {
  const raw = env.REDIS_URL;
  if (!raw || !raw.trim()) {
    throw new Error("REDIS_URL is required for Redis-backed production mode.");
  }
  const keyPrefix = (env.REDIS_KEY_PREFIX ?? "dat:").trim();
  return { keyPrefix, url: raw.trim() };
}

export function isRedisConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.REDIS_URL;
  return typeof raw === "string" && raw.trim().length > 0;
}

let sharedClient: Redis | null = null;
let bullMqClient: Redis | null = null;

type RedisCtor = typeof import("ioredis").default;

function buildClient(
  ctor: RedisCtor,
  options: {
    url: string;
    maxRetriesPerRequest: number | null;
  },
): Redis {
  // ioredis accepts the URL positionally; the options object carries the rest.
  // keyPrefix is intentionally NOT forwarded: createRedisKeys() already bakes
  // the configured prefix into every key, so adding it here would double every
  // key on the wire (e.g. "dat:dat:stream:r1").
  return new ctor(options.url, {
    enableReadyCheck: true,
    lazyConnect: false,
    maxRetriesPerRequest: options.maxRetriesPerRequest,
    retryStrategy(times: number) {
      return Math.min(1_000 + times * 500, 5_000);
    },
  });
}

async function importIOredis(): Promise<RedisCtor> {
  return (await import("ioredis")).default;
}

// Returns the shared ioredis client. The first call constructs and connects.
// Subsequent calls reuse the singleton. The shared client has
// maxRetriesPerRequest: 3 so commands fail (rather than hang) during outages,
// and does NOT apply keyPrefix — createRedisKeys() owns the prefix and already
// embeds it in every key it returns.
export async function getSharedRedis(): Promise<Redis> {
  if (sharedClient) return sharedClient;
  const ctor = await importIOredis();
  const { url } = resolveRedisOptions();
  sharedClient = buildClient(ctor, { maxRetriesPerRequest: 3, url });
  return sharedClient;
}

// BullMQ requires its own connection because it issues blocking reads that
// cannot share a client with non-blocking work. The BullMQ client sets
// maxRetriesPerRequest: null as BullMQ v5 demands, and does NOT apply
// keyPrefix (BullMQ manages its own keys).
export async function getBullMqRedis(): Promise<Redis> {
  if (bullMqClient) return bullMqClient;
  const ctor = await importIOredis();
  const { url } = resolveRedisOptions();
  bullMqClient = buildClient(ctor, { maxRetriesPerRequest: null, url });
  return bullMqClient;
}

// Graceful shutdown. Quit() lets Redis disconnect cleanly; never throws.
export async function closeRedisClients(): Promise<void> {
  const closing: Promise<unknown>[] = [];
  if (sharedClient) {
    closing.push(sharedClient.quit().catch(() => undefined));
    sharedClient = null;
  }
  if (bullMqClient) {
    closing.push(bullMqClient.quit().catch(() => undefined));
    bullMqClient = null;
  }
  await Promise.all(closing);
}

export type { Redis };
