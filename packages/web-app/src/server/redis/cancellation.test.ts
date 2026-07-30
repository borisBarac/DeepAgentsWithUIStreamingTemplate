import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { RedisCancellation } from "./cancellation.ts";
import { FakeRedis } from "./fake-redis.ts";

describe("RedisCancellation", () => {
  let client: FakeRedis;

  beforeEach(() => {
    client = new FakeRedis();
  });

  afterEach(() => {
    client._clear();
  });

  it("reports no cancellation for an untouched run", async () => {
    const cancel = new RedisCancellation({
      client: client.asRedis(),
      keyPrefix: "dat:",
      pollIntervalMs: 5,
    });
    expect(await cancel.isCancelled("r1")).toBe(false);
  });

  it("marks a run cancelled and clears it", async () => {
    const cancel = new RedisCancellation({
      client: client.asRedis(),
      keyPrefix: "dat:",
      pollIntervalMs: 5,
    });
    await cancel.cancel("r1");
    expect(await cancel.isCancelled("r1")).toBe(true);
    await cancel.clear("r1");
    expect(await cancel.isCancelled("r1")).toBe(false);
  });

  it("cancel is idempotent", async () => {
    const cancel = new RedisCancellation({
      client: client.asRedis(),
      keyPrefix: "dat:",
      pollIntervalMs: 5,
    });
    await cancel.cancel("r1");
    await cancel.cancel("r1");
    expect(await cancel.isCancelled("r1")).toBe(true);
  });

  it("isolates cancellation flags by runId", async () => {
    const cancel = new RedisCancellation({
      client: client.asRedis(),
      keyPrefix: "dat:",
      pollIntervalMs: 5,
    });
    await cancel.cancel("r1");
    expect(await cancel.isCancelled("r1")).toBe(true);
    expect(await cancel.isCancelled("r2")).toBe(false);
  });

  it("watch resolves true once the flag is set", async () => {
    const cancel = new RedisCancellation({
      client: client.asRedis(),
      keyPrefix: "dat:",
      pollIntervalMs: 5,
    });
    const controller = new AbortController();
    const watch = cancel.watch("r1", controller.signal);
    // Set the flag asynchronously so the polling loop observes it.
    setTimeout(() => void cancel.cancel("r1"), 5);
    expect(await watch).toBe(true);
  });

  it("watch resolves false when the abort signal fires first", async () => {
    const cancel = new RedisCancellation({
      client: client.asRedis(),
      keyPrefix: "dat:",
      pollIntervalMs: 5,
    });
    const controller = new AbortController();
    const watch = cancel.watch("r1", controller.signal);
    controller.abort();
    expect(await watch).toBe(false);
  });

  it("exposes the configured poll interval", () => {
    const cancel = new RedisCancellation({
      client: client.asRedis(),
      keyPrefix: "dat:",
      pollIntervalMs: 42,
    });
    expect(cancel.pollIntervalMs).toBe(42);
  });
});
