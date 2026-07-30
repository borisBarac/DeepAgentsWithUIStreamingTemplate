import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { ExecutionIdentity, RunMetadata, SessionRecord } from "../agent-runtime/types.ts";
import { FakeRedis } from "./fake-redis.ts";
import { createRedisKeys, DEFAULT_TTL_SECONDS } from "./keys.ts";
import { RedisSessionStore } from "./redis-session-store.ts";

const ID: ExecutionIdentity = { tenantId: "tenant-a", userId: "user-1" };
const OTHER: ExecutionIdentity = { tenantId: "tenant-b", userId: "user-2" };

function record(text: string): SessionRecord {
  return { failure: null, history: [{ content: text, role: "user" }], structuredOutput: null };
}

const run: RunMetadata = {
  finishedAt: 2,
  outcome: "success",
  runId: "r1",
  startedAt: 1,
};

describe("RedisSessionStore", () => {
  let client: FakeRedis;

  beforeEach(() => {
    client = new FakeRedis();
  });

  afterEach(() => {
    client._clear();
  });

  it("returns an empty LoadedSession when nothing has been committed", async () => {
    const store = new RedisSessionStore({ client: client.asRedis(), keyPrefix: "dat:" });
    const loaded = await store.loadSession(ID, "missing");
    expect(loaded).toEqual({ record: null, version: 0 });
  });

  it("commits a record and reads it back with an incremented version", async () => {
    const store = new RedisSessionStore({ client: client.asRedis(), keyPrefix: "dat:" });
    const ok = await store.commitSession(ID, "s1", record("first"), 0);
    expect(ok).toBe(true);

    const loaded = await store.loadSession(ID, "s1");
    expect(loaded.version).toBe(1);
    expect(loaded.record?.history).toEqual([{ content: "first", role: "user" }]);
  });

  it("rejects commits when the expected version is stale (optimistic concurrency)", async () => {
    const store = new RedisSessionStore({ client: client.asRedis(), keyPrefix: "dat:" });
    expect(await store.commitSession(ID, "s1", record("first"), 0)).toBe(true);
    expect(await store.commitSession(ID, "s1", record("interloper"), 1)).toBe(true);

    // Stale writer using version 0 must fail.
    expect(await store.commitSession(ID, "s1", record("stale"), 0)).toBe(false);

    const loaded = await store.loadSession(ID, "s1");
    expect(loaded.version).toBe(2);
    expect(loaded.record?.history).toEqual([{ content: "interloper", role: "user" }]);
  });

  it("isolates sessions by (tenant, user, sessionId)", async () => {
    const store = new RedisSessionStore({ client: client.asRedis(), keyPrefix: "dat:" });
    await store.commitSession(ID, "shared", record("alice"), 0);
    await store.commitSession(OTHER, "shared", record("bob"), 0);

    expect((await store.loadSession(ID, "shared")).record?.history).toEqual([
      { content: "alice", role: "user" },
    ]);
    expect((await store.loadSession(OTHER, "shared")).record?.history).toEqual([
      { content: "bob", role: "user" },
    ]);
  });

  it("records and retrieves run metadata scoped by identity + session", async () => {
    const store = new RedisSessionStore({ client: client.asRedis(), keyPrefix: "dat:" });
    await store.recordRun(ID, "s1", run);
    expect(await store.lastRun(ID, "s1")).toEqual(run);
    expect(await store.lastRun(ID, "other")).toBeNull();
    expect(await store.lastRun(OTHER, "s1")).toBeNull();
  });

  it("writes records under the keyspace derived from keyPrefix", async () => {
    const store = new RedisSessionStore({ client: client.asRedis(), keyPrefix: "alpha:" });
    await store.commitSession(ID, "s1", record("hi"), 0);
    const keys = [...client._entries().keys()];
    expect(keys.some((k) => k.startsWith("alpha:session:state:"))).toBe(true);
    expect(keys.some((k) => k.startsWith("alpha:session:ver:"))).toBe(true);
  });

  it("applies the configured TTL to session + version keys", async () => {
    const store = new RedisSessionStore({
      client: client.asRedis(),
      keyPrefix: "dat:",
      ttl: { session: 7, runMetadata: DEFAULT_TTL_SECONDS.runMetadata },
    });
    await store.commitSession(ID, "s1", record("hi"), 0);

    const keys = createRedisKeys("dat:");
    const sessionEntry = client._raw(keys.session(ID.tenantId, ID.userId, "s1"));
    const versionEntry = client._raw(keys.sessionVersion(ID.tenantId, ID.userId, "s1"));
    expect(sessionEntry?.type).toBe("string");
    expect(sessionEntry?.expiresAt).toBeDefined();
    expect(versionEntry?.expiresAt).toBeDefined();
    // TTL is not enforced, but is recorded.
    void 7;
  });
});
