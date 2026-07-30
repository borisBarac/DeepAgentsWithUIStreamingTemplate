import type Redis from "ioredis";

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

export async function getSharedRedis(): Promise<Redis> {
  if (sharedClient) return sharedClient;
  const ctor = await importIOredis();
  const { url } = resolveRedisOptions();
  sharedClient = buildClient(ctor, { maxRetriesPerRequest: 3, url });
  return sharedClient;
}

export async function getBullMqRedis(): Promise<Redis> {
  if (bullMqClient) return bullMqClient;
  const ctor = await importIOredis();
  const { url } = resolveRedisOptions();
  bullMqClient = buildClient(ctor, { maxRetriesPerRequest: null, url });
  return bullMqClient;
}

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
