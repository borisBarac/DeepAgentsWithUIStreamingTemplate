import { GenericContainer, type StartedTestContainer } from "testcontainers";

export type TestRedis = {
  readonly url: string;
  readonly keyPrefix: string;
  readonly stop: () => Promise<void>;
};

const REDIS_IMAGE = "redis:7-alpine";

// Boots an isolated Redis for a worker e2e run and exports a run-unique key
// prefix so reused Redis instances never collide across test runs. If
// REDIS_URL is already set in the environment (a locally-running Redis or a CI
// service), it is reused verbatim and no container is started — only a unique
// REDIS_KEY_PREFIX is layered on top for isolation.
//
// The URL + prefix are written to process.env so the lazy ioredis singletons in
// src/server/redis/client.ts (read via resolveRedisOptions()) pick them up on
// first use. Call stop() in afterAll to tear the container down.
export async function startTestRedis(): Promise<TestRedis> {
  const keyPrefix = `e2e:${crypto.randomUUID().slice(0, 8)}:`;
  process.env.REDIS_KEY_PREFIX = keyPrefix;

  const existing = process.env.REDIS_URL?.trim();
  if (existing) {
    return {
      url: existing,
      keyPrefix,
      stop: async () => {
        if (process.env.REDIS_KEY_PREFIX === keyPrefix) delete process.env.REDIS_KEY_PREFIX;
      },
    };
  }

  const container: StartedTestContainer = await new GenericContainer(REDIS_IMAGE)
    .withExposedPorts(6379)
    .withStartupTimeout(60_000)
    .start();
  const url = `redis://${container.getHost()}:${container.getMappedPort(6379)}`;
  process.env.REDIS_URL = url;

  return {
    url,
    keyPrefix,
    stop: async () => {
      await container.stop({ remove: true }).catch(() => undefined);
      if (process.env.REDIS_URL === url) delete process.env.REDIS_URL;
      if (process.env.REDIS_KEY_PREFIX === keyPrefix) delete process.env.REDIS_KEY_PREFIX;
    },
  };
}
