import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { ExecutionResult } from "../agent-runtime/types.ts";
import { RedisEventStream, type RunEventEnvelope } from "./event-stream.ts";
import { FakeRedis } from "./fake-redis.ts";

const RESULT: ExecutionResult = {
  outcome: "success",
  failure: null,
  history: [],
  structuredOutput: null,
  finalText: "",
};

describe("RedisEventStream", () => {
  let client: FakeRedis;

  beforeEach(() => {
    client = new FakeRedis();
  });

  afterEach(() => {
    client._clear();
  });

  it("publishes UI updates and reads them back in order", async () => {
    const stream = new RedisEventStream({ client: client.asRedis(), keyPrefix: "dat:" });
    await stream.publishUi("r1", { type: "message", text: "first" });
    await stream.publishUi("r1", { type: "message", text: "second" });

    const batch = await stream.read("r1", "0", 0, 10);
    expect(batch).toHaveLength(2);
    expect(batch[0]?.envelope.update).toEqual({ type: "message", text: "first" });
    expect(batch[1]?.envelope.update).toEqual({ type: "message", text: "second" });
  });

  it("isolates identical run ids by identity", async () => {
    const stream = new RedisEventStream({ client: client.asRedis(), keyPrefix: "dat:" });
    const alice = { tenantId: "guest", userId: "alice" };
    const bob = { tenantId: "guest", userId: "bob" };
    await stream.publishUi(alice, "shared", { type: "message", text: "alice" });
    expect(await stream.read(alice, "shared", "0", 0, 10)).toHaveLength(1);
    expect(await stream.read(bob, "shared", "0", 0, 10)).toEqual([]);
  });

  it("publishes a terminal result event and a lifecycle event", async () => {
    const stream = new RedisEventStream({ client: client.asRedis(), keyPrefix: "dat:" });
    await stream.publishLifecycle("r1", "started");
    await stream.publishResult("r1", RESULT);

    const batch = await stream.read("r1", "0", 0, 10);
    expect(batch).toHaveLength(2);
    expect(batch[0]?.envelope.kind).toBe("lifecycle");
    expect(batch[0]?.envelope.phase).toBe("started");
    expect(batch[1]?.envelope.kind).toBe("result");
    expect(batch[1]?.envelope.result).toEqual(RESULT);
  });

  it("publishes an error event with the message", async () => {
    const stream = new RedisEventStream({ client: client.asRedis(), keyPrefix: "dat:" });
    await stream.publishError("r1", "kaboom");
    const batch = await stream.read("r1", "0", 0, 10);
    expect(batch[0]?.envelope).toMatchObject({ kind: "error", message: "kaboom" });
  });

  it("read returns an empty array when no events are available", async () => {
    const stream = new RedisEventStream({ client: client.asRedis(), keyPrefix: "dat:" });
    const batch = await stream.read("r1", "0", 0, 10);
    expect(batch).toEqual([]);
  });

  it("respects the afterId cursor to read only newer events", async () => {
    const stream = new RedisEventStream({ client: client.asRedis(), keyPrefix: "dat:" });
    await stream.publishUi("r1", { type: "message", text: "one" });
    await stream.publishUi("r1", { type: "message", text: "two" });
    const firstBatch = await stream.read("r1", "0", 0, 1);
    expect(firstBatch).toHaveLength(1);
    expect(firstBatch[0]?.envelope.update).toEqual({ type: "message", text: "one" });
    const after = firstBatch[0]?.id;
    expect(after).toBeDefined();

    const secondBatch = await stream.read("r1", after as string, 0, 10);
    expect(secondBatch).toHaveLength(1);
    expect(secondBatch[0]?.envelope.update).toEqual({ type: "message", text: "two" });
  });

  it("decodes the real ioredis nested-array XREAD reply shape", async () => {
    const stream = new RedisEventStream({ client: client.asRedis(), keyPrefix: "dat:" });
    const key = stream.streamKey("r1");
    const envelope: RunEventEnvelope = {
      kind: "ui",
      ts: 1,
      update: { type: "message", text: "real" },
    };
    // Real ioredis returns: [[streamKey, [[id, [field, value, ...]], ...]]]
    client._xreadReplies.push([
      [key, [["1700000000000-0", ["payload", JSON.stringify(envelope)]]]],
    ]);
    const batch = await stream.read("r1", "0", 0, 10);
    expect(batch).toHaveLength(1);
    expect(batch[0]?.id).toBe("1700000000000-0");
    expect(batch[0]?.envelope).toEqual(envelope);
  });

  it("rejects an XREAD reply whose stream key is doubled (regression guard for an39)", async () => {
    // Before an39 the shared ioredis client forwarded keyPrefix on top of the
    // prefix createRedisKeys() already baked in, so the on-wire stream key was
    // "dat:dat:stream:r1" for logical "dat:stream:r1" and decodeXReadReply used
    // a suffix-match fallback to tolerate it. After an39 the client no longer
    // forwards keyPrefix, so the on-wire key equals the logical key and strict
    // equality is correct — a doubled key must now be rejected.
    const stream = new RedisEventStream({ client: client.asRedis(), keyPrefix: "dat:" });
    const logicalKey = stream.streamKey("r1");
    const doubledKey = `dat:${logicalKey}`;
    const envelope: RunEventEnvelope = {
      kind: "ui",
      ts: 1,
      update: { type: "message", text: "doubled" },
    };
    client._xreadReplies.push([
      [doubledKey, [["1700000000001-0", ["payload", JSON.stringify(envelope)]]]],
    ]);
    const batch = await stream.read("r1", "0", 0, 10);
    expect(batch).toEqual([]);
  });

  it("returns an empty batch for malformed XREAD reply shapes", async () => {
    const stream = new RedisEventStream({ client: client.asRedis(), keyPrefix: "dat:" });
    const key = stream.streamKey("r1");

    const malformed: unknown[] = [
      { [key]: [["1-0", ["payload", "{}"]]] }, // the old buggy object shape
      "not-an-array", // non-array reply
      [["other:stream:r1", [["1-0", ["payload", "{}"]]]]], // wrong stream key
      [[key, [["1-0", null]]]], // entry missing its fields array
      [], // empty reply array
    ];

    for (const reply of malformed) {
      client._xreadReplies.push(reply);
      const batch = await stream.read("r1", "0", 0, 10);
      expect(batch).toEqual([]);
    }
  });

  it("skips stream entries whose payload is not valid JSON", async () => {
    const stream = new RedisEventStream({ client: client.asRedis(), keyPrefix: "dat:" });
    const key = stream.streamKey("r1");
    // Write a corrupt payload directly, then a valid UI update.
    await client.xadd(key, "*", "payload", "{not json");
    await stream.publishUi("r1", { type: "message", text: "ok" });
    const batch = await stream.read("r1", "0", 0, 10);
    expect(batch).toHaveLength(1);
    expect(batch[0]?.envelope.update).toEqual({ type: "message", text: "ok" });
  });

  it("trim bounds stream length", async () => {
    const stream = new RedisEventStream({
      client: client.asRedis(),
      keyPrefix: "dat:",
      maxLength: 2,
    });
    for (let i = 0; i < 5; i++) {
      await stream.publishUi("r1", { type: "message", text: `m${i}` });
    }
    expect(await stream.length("r1")).toBeLessThanOrEqual(5);
    await stream.trim("r1");
    expect(await stream.length("r1")).toBeLessThanOrEqual(2);
  });

  it("streamKey uses the configured prefix", () => {
    const stream = new RedisEventStream({ client: client.asRedis(), keyPrefix: "alpha:" });
    expect(stream.streamKey("r1")).toBe("alpha:stream:r1");
  });
});
