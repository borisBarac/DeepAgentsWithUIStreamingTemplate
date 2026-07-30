import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import Redis from "ioredis";

import { RedisMemoryStore } from "../src/server/redis/redis-memory-store.ts";
import { startTestRedis, type TestRedis } from "./redis-harness.ts";

async function redisAvailable(): Promise<boolean> {
  if (process.env.DOCKER_AVAILABLE === "0" || process.env.DOCKER_AVAILABLE === "false") {
    return Boolean(process.env.REDIS_URL?.trim());
  }
  if (process.env.REDIS_URL?.trim()) return true;
  try {
    const proc = Bun.spawn({ cmd: ["docker", "info"], stderr: "ignore", stdout: "ignore" });
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}

const REDIS_AVAILABLE = await redisAvailable();
const testIf = REDIS_AVAILABLE ? it : it.skip;

let redis: TestRedis | null = null;
let writer: Redis | null = null;
let reader: Redis | null = null;

beforeAll(async () => {
  if (!REDIS_AVAILABLE) return;
  redis = await startTestRedis();
  writer = new Redis(redis.url);
  reader = new Redis(redis.url);
});

afterAll(async () => {
  await Promise.all([writer?.quit(), reader?.quit()]);
  writer = null;
  reader = null;
  await redis?.stop();
  redis = null;
});

describe("RedisMemoryStore integration", () => {
  testIf("persists memory across separate Redis clients", async () => {
    if (!redis || !writer || !reader) throw new Error("Redis test setup failed.");
    const first = new RedisMemoryStore({ client: writer, keyPrefix: redis.keyPrefix });
    const second = new RedisMemoryStore({ client: reader, keyPrefix: redis.keyPrefix });

    await first.put(["single-user"], "/memory/project-facts.md", { content: "persistent fact" });

    await expect(second.get(["single-user"], "/memory/project-facts.md")).resolves.toMatchObject({
      value: { content: "persistent fact" },
    });
  });
});
