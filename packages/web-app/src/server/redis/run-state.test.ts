import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { FakeRedis } from "./fake-redis.ts";
import { RedisRunStateStore } from "./run-state.ts";

describe("RedisRunStateStore", () => {
  let client: FakeRedis;

  beforeEach(() => {
    client = new FakeRedis();
  });

  afterEach(() => {
    client._clear();
  });

  it("records a queued run with the identity + session", async () => {
    const store = new RedisRunStateStore({ client: client.asRedis(), keyPrefix: "dat:" });
    await store.recordQueued({
      identity: { tenantId: "t", userId: "u" },
      runId: "r1",
      sessionId: "s1",
      startedAt: 100,
      status: "queued",
    });
    const record = await store.get("r1");
    expect(record).toMatchObject({
      runId: "r1",
      sessionId: "s1",
      status: "queued",
      startedAt: 100,
    });
  });

  it("transitions queued → running → completed preserving identity", async () => {
    const store = new RedisRunStateStore({ client: client.asRedis(), keyPrefix: "dat:" });
    await store.recordQueued({
      identity: { tenantId: "t", userId: "u" },
      runId: "r1",
      sessionId: "s1",
      startedAt: 100,
      status: "queued",
    });
    await store.recordRunning("r1");
    await store.recordCompleted("r1");

    const record = await store.get("r1");
    expect(record?.status).toBe("completed");
    expect(record?.finishedAt).toBeGreaterThan(0);
    expect(record?.identity).toEqual({ tenantId: "t", userId: "u" });
    expect(record?.sessionId).toBe("s1");
  });

  it("records failure with the failure message", async () => {
    const store = new RedisRunStateStore({ client: client.asRedis(), keyPrefix: "dat:" });
    await store.recordQueued({
      identity: { tenantId: "t", userId: "u" },
      runId: "r1",
      sessionId: "s1",
      startedAt: 1,
      status: "queued",
    });
    await store.recordFailed("r1", "boom");
    const record = await store.get("r1");
    expect(record?.status).toBe("failed");
    expect(record?.failureMessage).toBe("boom");
  });

  it("records cancelled without losing the started identity", async () => {
    const store = new RedisRunStateStore({ client: client.asRedis(), keyPrefix: "dat:" });
    await store.recordQueued({
      identity: { tenantId: "t", userId: "u" },
      runId: "r1",
      sessionId: "s1",
      startedAt: 1,
      status: "queued",
    });
    await store.recordCancelled("r1");
    const record = await store.get("r1");
    expect(record?.status).toBe("cancelled");
    expect(record?.identity).toEqual({ tenantId: "t", userId: "u" });
  });

  it("returns null for an unknown run", async () => {
    const store = new RedisRunStateStore({ client: client.asRedis(), keyPrefix: "dat:" });
    expect(await store.get("unknown")).toBeNull();
  });

  it("isolates state by runId", async () => {
    const store = new RedisRunStateStore({ client: client.asRedis(), keyPrefix: "dat:" });
    await store.recordQueued({
      identity: { tenantId: "t", userId: "u" },
      runId: "r1",
      sessionId: "s1",
      startedAt: 1,
      status: "queued",
    });
    await store.recordQueued({
      identity: { tenantId: "t", userId: "u" },
      runId: "r2",
      sessionId: "s1",
      startedAt: 1,
      status: "queued",
    });
    await store.recordCompleted("r1");
    expect((await store.get("r1"))?.status).toBe("completed");
    expect((await store.get("r2"))?.status).toBe("queued");
  });
});

describe("RedisRunStateStore out-of-order transitions", () => {
  let client: FakeRedis;

  beforeEach(() => {
    client = new FakeRedis();
  });

  afterEach(() => {
    client._clear();
  });

  it("throws when recordRunning runs before recordQueued", async () => {
    const store = new RedisRunStateStore({ client: client.asRedis(), keyPrefix: "dat:" });
    await expect(store.recordRunning("r1")).rejects.toThrow(
      'Run state for r1 cannot transition to "running" before "queued"',
    );
    expect(await store.get("r1")).toBeNull();
  });

  it("throws when recordCompleted runs before recordQueued", async () => {
    const store = new RedisRunStateStore({ client: client.asRedis(), keyPrefix: "dat:" });
    await expect(store.recordCompleted("r1")).rejects.toThrow(
      'Run state for r1 cannot transition to "completed" before "queued"',
    );
    expect(await store.get("r1")).toBeNull();
  });

  it("throws when recordFailed runs before recordQueued", async () => {
    const store = new RedisRunStateStore({ client: client.asRedis(), keyPrefix: "dat:" });
    await expect(store.recordFailed("r1", "boom")).rejects.toThrow(
      'Run state for r1 cannot transition to "failed" before "queued"',
    );
    expect(await store.get("r1")).toBeNull();
  });

  it("throws when recordCancelled runs before recordQueued", async () => {
    const store = new RedisRunStateStore({ client: client.asRedis(), keyPrefix: "dat:" });
    await expect(store.recordCancelled("r1")).rejects.toThrow(
      'Run state for r1 cannot transition to "cancelled" before "queued"',
    );
    expect(await store.get("r1")).toBeNull();
  });

  it("never persists an empty-identity record from a rejected transition", async () => {
    const store = new RedisRunStateStore({ client: client.asRedis(), keyPrefix: "dat:" });
    await expect(store.recordRunning("r1")).rejects.toThrow();
    await expect(store.recordFailed("r1", "boom")).rejects.toThrow();
    await expect(store.recordCompleted("r1")).rejects.toThrow();
    expect(await store.get("r1")).toBeNull();
    expect(client._entries().size).toBe(0);
  });

  it("recordQueued still creates a valid record from its inputs", async () => {
    const store = new RedisRunStateStore({ client: client.asRedis(), keyPrefix: "dat:" });
    await store.recordQueued({
      identity: { tenantId: "t", userId: "u" },
      runId: "r1",
      sessionId: "s1",
      startedAt: 100,
      status: "queued",
    });
    const record = await store.get("r1");
    expect(record).not.toBeNull();
    expect(record).toMatchObject({
      runId: "r1",
      identity: { tenantId: "t", userId: "u" },
      sessionId: "s1",
      startedAt: 100,
      status: "queued",
    });
  });
});
