import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { FakeRedis } from "./fake-redis.ts";
import { createRedisKeys } from "./keys.ts";
import { RedisSessionLock } from "./session-lock.ts";

const TENANT = "tenant-a";
const USER = "user-1";
const SESSION = "s1";

describe("RedisSessionLock", () => {
  let client: FakeRedis;

  beforeEach(() => {
    client = new FakeRedis();
  });

  afterEach(() => {
    client._clear();
  });

  it("acquires the lock for an empty key and embeds a fencing token", async () => {
    const lock = new RedisSessionLock({ client: client.asRedis(), keyPrefix: "dat:" });
    const result = await lock.acquire(TENANT, USER, SESSION, "run-1");
    expect(result.acquired).toBe(true);
    if (result.acquired) {
      expect(result.fencingToken).toBeGreaterThan(0);
      expect(result.lock.runId).toBe("run-1");
    }
  });

  it("rejects a second concurrent acquire and returns the current holder", async () => {
    const lock = new RedisSessionLock({ client: client.asRedis(), keyPrefix: "dat:" });
    const first = await lock.acquire(TENANT, USER, SESSION, "run-1");
    expect(first.acquired).toBe(true);

    const second = await lock.acquire(TENANT, USER, SESSION, "run-2");
    expect(second.acquired).toBe(false);
    if (!second.acquired) {
      expect(second.holder.runId).toBe("run-1");
    }
  });

  it("isolates locks by (tenant, user, session)", async () => {
    const lock = new RedisSessionLock({ client: client.asRedis(), keyPrefix: "dat:" });
    const a = await lock.acquire(TENANT, USER, SESSION, "run-a");
    const b = await lock.acquire(TENANT, "user-2", SESSION, "run-b");
    expect(a.acquired).toBe(true);
    expect(b.acquired).toBe(true);
  });

  it("allocates monotonically increasing fencing tokens for repeated acquires", async () => {
    const lock = new RedisSessionLock({ client: client.asRedis(), keyPrefix: "dat:" });
    const first = await lock.acquire(TENANT, USER, SESSION, "run-1");
    expect(first.acquired).toBe(true);
    if (!first.acquired) throw new Error("first acquire failed");
    const firstToken = first.fencingToken;

    expect(await lock.release(TENANT, USER, SESSION, firstToken)).toBe(true);

    const second = await lock.acquire(TENANT, USER, SESSION, "run-2");
    expect(second.acquired).toBe(true);
    if (!second.acquired) throw new Error("second acquire failed");
    expect(second.fencingToken).toBeGreaterThan(firstToken);
  });

  it("refreshes the lease only while our fencing token still matches", async () => {
    const lock = new RedisSessionLock({ client: client.asRedis(), keyPrefix: "dat:" });
    const acquired = await lock.acquire(TENANT, USER, SESSION, "run-1");
    if (!acquired.acquired) throw new Error("acquire failed");
    expect(await lock.refresh(TENANT, USER, SESSION, acquired.fencingToken)).toBe(true);
    expect(await lock.refresh(TENANT, USER, SESSION, acquired.fencingToken + 999)).toBe(false);
  });

  it("releases the lock only when the stored fencing token matches", async () => {
    const lock = new RedisSessionLock({ client: client.asRedis(), keyPrefix: "dat:" });
    const acquired = await lock.acquire(TENANT, USER, SESSION, "run-1");
    if (!acquired.acquired) throw new Error("acquire failed");

    expect(await lock.release(TENANT, USER, SESSION, acquired.fencingToken + 1)).toBe(false);
    const stillHeld = await lock.currentHolder(TENANT, USER, SESSION);
    expect(stillHeld?.runId).toBe("run-1");

    expect(await lock.release(TENANT, USER, SESSION, acquired.fencingToken)).toBe(true);
    expect(await lock.currentHolder(TENANT, USER, SESSION)).toBeNull();

    const reacquired = await lock.acquire(TENANT, USER, SESSION, "run-2");
    expect(reacquired.acquired).toBe(true);
  });

  it("currentHolder returns null when no lock is held", async () => {
    const lock = new RedisSessionLock({ client: client.asRedis(), keyPrefix: "dat:" });
    expect(await lock.currentHolder(TENANT, USER, SESSION)).toBeNull();
  });

  it("allocates a token greater than every earlier token after lease expiry", async () => {
    const lock = new RedisSessionLock({ client: client.asRedis(), keyPrefix: "dat:" });
    const tokens: number[] = [];

    for (let i = 0; i < 3; i++) {
      const acquired = await lock.acquire(TENANT, USER, SESSION, `run-${i}`);
      if (!acquired.acquired) throw new Error(`acquire #${i} failed`);
      tokens.push(acquired.fencingToken);
      expect(await lock.release(TENANT, USER, SESSION, acquired.fencingToken)).toBe(true);
    }

    const lockKey = createRedisKeys("dat:").sessionLock(TENANT, USER, SESSION);
    await client.del(lockKey);

    const reacquired = await lock.acquire(TENANT, USER, SESSION, "run-after-expiry");
    if (!reacquired.acquired) throw new Error("reacquire after expiry failed");
    for (const earlier of tokens) {
      expect(reacquired.fencingToken).toBeGreaterThan(earlier);
    }
  });
});
