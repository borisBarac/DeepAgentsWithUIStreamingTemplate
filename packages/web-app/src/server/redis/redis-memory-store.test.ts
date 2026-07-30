import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Item, Operation } from "@langchain/langgraph";

import { FakeRedis } from "./fake-redis.ts";
import { createRedisKeys, hashNamespace } from "./keys.ts";
import { RedisMemoryStore } from "./redis-memory-store.ts";

describe("RedisMemoryStore", () => {
  let client: FakeRedis;

  beforeEach(() => {
    client = new FakeRedis();
  });

  afterEach(() => {
    client._clear();
  });

  it("put + get round-trips an item with its namespace and key", async () => {
    const store = new RedisMemoryStore({ client: client.asRedis(), keyPrefix: "dat:" });
    await store.put(["t", "u", "mem"], "note", { content: "hello" });
    const item = await store.get(["t", "u", "mem"], "note");
    expect(item).not.toBeNull();
    expect(item?.key).toBe("note");
    expect(item?.namespace).toEqual(["t", "u", "mem"]);
    expect(item?.value).toEqual({ content: "hello" });
    expect(item?.createdAt).toBeInstanceOf(Date);
  });

  it("returns null when the item is missing", async () => {
    const store = new RedisMemoryStore({ client: client.asRedis(), keyPrefix: "dat:" });
    expect(await store.get(["t", "u", "mem"], "missing")).toBeNull();
  });

  it("ignores malformed, unsupported, and invalid memory records", async () => {
    const store = new RedisMemoryStore({ client: client.asRedis(), keyPrefix: "dat:" });
    const namespace = ["t", "u", "mem"];
    const namespaceHash = hashNamespace(namespace);
    const keys = createRedisKeys("dat:");
    await client.set(keys.memoryItem(namespaceHash, "malformed"), "not json");
    await client.set(keys.memoryItem(namespaceHash, "unsupported"), '{"v":2,"payload":{}}');
    await client.set(keys.memoryItem(namespaceHash, "invalid"), '{"v":1,"payload":{}}');
    await client.sadd(
      keys.memoryNamespaceIndex(namespaceHash),
      "malformed",
      "unsupported",
      "invalid",
    );
    await client.sadd(keys.memoryNamespaceRegistry(), JSON.stringify(namespace));

    expect(await store.get(namespace, "malformed")).toBeNull();
    expect(await store.get(namespace, "unsupported")).toBeNull();
    expect(await store.get(namespace, "invalid")).toBeNull();
    expect(await store.search(["t"], { limit: 10, offset: 0 })).toEqual([]);
    expect(await store.listNamespaces({ limit: 10, offset: 0 })).toEqual([]);
  });

  it("isolates items by namespace + key", async () => {
    const store = new RedisMemoryStore({ client: client.asRedis(), keyPrefix: "dat:" });
    await store.put(["t", "u", "mem"], "a", { content: "A" });
    await store.put(["t", "u", "mem"], "b", { content: "B" });
    await store.put(["t", "u", "other"], "a", { content: "other-A" });
    expect((await store.get(["t", "u", "mem"], "a"))?.value).toEqual({ content: "A" });
    expect((await store.get(["t", "u", "mem"], "b"))?.value).toEqual({ content: "B" });
    expect((await store.get(["t", "u", "other"], "a"))?.value).toEqual({ content: "other-A" });
  });

  it("put twice preserves createdAt and bumps updatedAt", async () => {
    const store = new RedisMemoryStore({ client: client.asRedis(), keyPrefix: "dat:" });
    await store.put(["t", "u", "mem"], "note", { content: "v1" });
    const first = await store.get(["t", "u", "mem"], "note");
    if (!first) throw new Error("expected first item");
    await wait(2);
    await store.put(["t", "u", "mem"], "note", { content: "v2" });
    const second = await store.get(["t", "u", "mem"], "note");
    if (!second) throw new Error("expected second item");
    expect(second.value).toEqual({ content: "v2" });
    expect(first.createdAt).toEqual(second.createdAt);
    expect(second.updatedAt.getTime()).toBeGreaterThan(first.updatedAt.getTime());
  });

  it("delete removes an item and its index entry", async () => {
    const store = new RedisMemoryStore({ client: client.asRedis(), keyPrefix: "dat:" });
    await store.put(["t", "u", "mem"], "note", { content: "hello" });
    await store.delete(["t", "u", "mem"], "note");
    expect(await store.get(["t", "u", "mem"], "note")).toBeNull();
    expect(await store.listNamespaces({ limit: 10, offset: 0 })).toEqual([]);
  });

  it("search returns items in the matching namespace prefix", async () => {
    const store = new RedisMemoryStore({ client: client.asRedis(), keyPrefix: "dat:" });
    await store.put(["t", "u", "mem"], "a", { content: "alpha" });
    await store.put(["t", "u", "mem"], "b", { content: "beta" });
    await store.put(["t", "v", "mem"], "c", { content: "gamma" });

    const results = (await store.search(["t", "u"], { limit: 10, offset: 0 })).map(
      (i: Item) => i.key,
    );
    expect(results.sort()).toEqual(["a", "b"]);
  });

  it("search filters by full-text query over value content", async () => {
    const store = new RedisMemoryStore({ client: client.asRedis(), keyPrefix: "dat:" });
    await store.put(["t", "u", "mem"], "a", { content: "find me please" });
    await store.put(["t", "u", "mem"], "b", { content: "ignore me" });
    const results = (await store.search(["t", "u"], { limit: 10, offset: 0, query: "find" })).map(
      (i: Item) => i.key,
    );
    expect(results).toEqual(["a"]);
  });

  it("search filters, orders, and paginates results", async () => {
    const store = new RedisMemoryStore({ client: client.asRedis(), keyPrefix: "dat:" });
    await store.put(["t", "u", "mem"], "b", { priority: 2 });
    await store.put(["t", "u", "mem"], "a", { priority: 1 });
    await store.put(["t", "u", "mem"], "c", { priority: 3 });

    const results = await store.search(["t", "u"], {
      filter: { priority: { $gte: 2 } },
      limit: 1,
      offset: 1,
    });
    expect(results.map((item) => item.key)).toEqual(["c"]);
  });

  it("batch handles mixed operations in declaration order", async () => {
    const store = new RedisMemoryStore({ client: client.asRedis(), keyPrefix: "dat:" });
    await store.put(["t", "u", "mem"], "shared", { content: "seed" });
    const ops = [
      { key: "first", namespace: ["t", "u", "mem"], value: { content: "1" } },
      { key: "second", namespace: ["t", "u", "mem"], value: { content: "2" } },
      { key: "shared", namespace: ["t", "u", "mem"], value: null },
      { key: "shared", namespace: ["t", "u", "mem"] },
      { namespacePrefix: ["t", "u"], limit: 10, offset: 0 },
    ] as unknown as Operation[];
    const results = await store.batch(ops);
    expect(results[3]).toBeNull();
    const searchResult = results[4] as Item[] | undefined;
    if (!searchResult) throw new Error("expected search results");
    const items = searchResult.map((i) => i.key).sort();
    expect(items).toEqual(["first", "second"]);
  });

  it("listNamespaces enumerates distinct namespaces and respects prefix filters", async () => {
    const store = new RedisMemoryStore({ client: client.asRedis(), keyPrefix: "dat:" });
    await store.put(["t", "u", "mem"], "a", {});
    await store.put(["t", "v", "mem"], "b", {});
    await store.put(["t", "w", "mem"], "c", {});
    const all = await store.listNamespaces({ limit: 10, offset: 0 });
    expect(all.sort()).toEqual([
      ["t", "u", "mem"],
      ["t", "v", "mem"],
      ["t", "w", "mem"],
    ]);
    const filtered = await store.listNamespaces({
      limit: 10,
      offset: 0,
      prefix: ["t", "u"],
    });
    expect(filtered).toEqual([["t", "u", "mem"]]);
  });

  it("sets one absolute TTL across the guest memory namespace", async () => {
    const store = new RedisMemoryStore({ client: client.asRedis(), keyPrefix: "dat:" });
    await store.put(["t", "u", "mem"], "note", { content: "hello" });
    const namespaceHash = hashNamespace(["t", "u", "mem"]);
    const keys = createRedisKeys("dat:");
    const itemKey = keys.memoryItem(namespaceHash, "note");
    const entry = client._raw(itemKey);
    expect(entry).toBeDefined();
    expect(entry?.expiresAt).toBeDefined();
    expect(client._raw(keys.memoryNamespaceIndex(namespaceHash))?.expiresAt).toBeDefined();
    expect(client._raw(keys.memoryNamespaceExpiry(namespaceHash))?.expiresAt).toBeDefined();
    expect(client._raw(keys.memoryNamespaceRegistry())?.expiresAt).toBeUndefined();
  });

  it("does not renew namespace expiry and starts fresh after expiry", async () => {
    const store = new RedisMemoryStore({
      client: client.asRedis(),
      keyPrefix: "dat:",
      namespaceTtlSeconds: 1,
    });
    const namespace = ["users", "guest:a", "memory"];
    const namespaceHash = hashNamespace(namespace);
    const keys = createRedisKeys("dat:");
    await store.put(namespace, "first", { content: "one" });
    const expiresAt = client._raw(keys.memoryNamespaceExpiry(namespaceHash))?.expiresAt;
    await wait(10);
    await store.put(namespace, "second", { content: "two" });
    expect(client._raw(keys.memoryNamespaceExpiry(namespaceHash))?.expiresAt).toBe(expiresAt);
    await wait(1_050);
    expect(await store.get(namespace, "first")).toBeNull();
    await store.put(namespace, "fresh", { content: "new" });
    expect(await store.get(namespace, "fresh")).not.toBeNull();
  });

  it("isolates keys by keyPrefix", async () => {
    const storeA = new RedisMemoryStore({ client: client.asRedis(), keyPrefix: "alpha:" });
    const storeB = new RedisMemoryStore({ client: client.asRedis(), keyPrefix: "beta:" });
    await storeA.put(["t", "u", "mem"], "x", { content: "A" });
    await storeB.put(["t", "u", "mem"], "x", { content: "B" });
    expect((await storeA.get(["t", "u", "mem"], "x"))?.value).toEqual({ content: "A" });
    expect((await storeB.get(["t", "u", "mem"], "x"))?.value).toEqual({ content: "B" });
  });
});

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
