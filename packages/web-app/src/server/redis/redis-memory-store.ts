import {
  BaseStore,
  type Item,
  type MatchCondition,
  type Operation,
  type OperationResults,
  type PutOperation,
} from "@langchain/langgraph";
import type { Redis } from "ioredis";

import { MEMORY_ITEM_SCHEMA_VERSION, type MemoryItemRecord, RedisCodec } from "./codec.ts";
import { createRedisKeys, hashNamespace, type RedisKeyspaces, type TtlConfig } from "./keys.ts";

// Redis-backed BaseStore. Mirrors the FileSystemMemoryStore approach: items
// live at `memory:item:{namespaceHash}:{keyHash}`, a SET at
// `memory:idx:{namespaceHash}` tracks the keys in each namespace, and a SET at
// `memory:namespaces` records every namespace tuple seen so listNamespaces
// can enumerate them. Search and listNamespaces filter in TS after reading the
// index — same strategy as the filesystem adapter, no inverted index.
//
// All keys expire via the per-namespace index TTL propagated when an item is
// written. Reads tolerate missing indexes (a GET still works after the index
// TTL has lapsed if the item TTL has not).

const itemCodec = new RedisCodec<MemoryItemRecord>(MEMORY_ITEM_SCHEMA_VERSION);

type StoreSearchItem = Item;

const DEFAULT_MEMORY_TTL_SECONDS = 60 * 60 * 24 * 7;

export type RedisMemoryStoreOptions = {
  readonly client: Redis;
  readonly keyPrefix: string;
  readonly ttl?: TtlConfig & { memory?: number };
};

function toStoredRecord(
  namespace: readonly string[],
  key: string,
  value: Record<string, unknown>,
  existing: MemoryItemRecord | null,
): MemoryItemRecord {
  const now = new Date().toISOString();
  return {
    createdAt: existing?.createdAt ?? now,
    key,
    namespace: [...namespace],
    updatedAt: now,
    value,
  };
}

function toSearchItem(record: MemoryItemRecord): Item {
  return {
    createdAt: new Date(record.createdAt),
    key: record.key,
    namespace: [...record.namespace],
    updatedAt: new Date(record.updatedAt),
    value: { ...record.value },
  };
}

export class RedisMemoryStore extends BaseStore {
  readonly #client: Redis;
  readonly #keys: RedisKeyspaces;
  readonly #memoryTtl: number;

  constructor(options: RedisMemoryStoreOptions) {
    super();
    this.#client = options.client;
    this.#keys = createRedisKeys(options.keyPrefix);
    this.#memoryTtl = options.ttl?.memory ?? DEFAULT_MEMORY_TTL_SECONDS;
  }

  override async batch<Op extends Operation[]>(operations: Op): Promise<OperationResults<Op>> {
    const results: unknown[] = [];
    for (const op of operations) {
      if ("namespacePrefix" in op) {
        results.push(await this.#search(op));
      } else if ("value" in op) {
        await this.#put(op);
        results.push(undefined);
      } else if ("key" in op && "namespace" in op) {
        results.push(await this.#get(op.namespace, op.key));
      } else if ("matchConditions" in op) {
        results.push(await this.#listNamespaces(op));
      } else {
        throw new Error("Unsupported memory store operation.");
      }
    }
    return results as OperationResults<Op>;
  }

  override async put(
    namespace: string[],
    key: string,
    value: Record<string, unknown>,
    _index?: false | string[],
  ): Promise<void> {
    await this.batch([{ index: _index, key, namespace, value }]);
  }

  override async delete(namespace: string[], key: string): Promise<void> {
    await this.batch([{ key, namespace, value: null }]);
  }

  async #get(namespace: readonly string[], key: string): Promise<Item | null> {
    const namespaceHash = hashNamespace(namespace);
    const itemKey = this.#keys.memoryItem(namespaceHash, key);
    const raw = await this.#client.get(itemKey);
    const record = itemCodec.decode(raw);
    if (!record) return null;
    return toSearchItem(record);
  }

  async #put(op: PutOperation): Promise<void> {
    const namespace = op.namespace;
    const namespaceHash = hashNamespace(namespace);
    const itemKey = this.#keys.memoryItem(namespaceHash, op.key);
    const indexKey = this.#keys.memoryNamespaceIndex(namespaceHash);
    const registryKey = this.#keys.memoryNamespaceRegistry();

    if (op.value === null) {
      await this.#client.multi().del(itemKey).srem(indexKey, op.key).exec();
      return;
    }

    const existingRaw = await this.#client.get(itemKey);
    const existing = itemCodec.decode(existingRaw);
    const record = toStoredRecord(namespace, op.key, op.value, existing);
    const encoded = itemCodec.encode(record);
    const namespaceTuple = JSON.stringify(namespace);

    await this.#client
      .multi()
      .set(itemKey, encoded, "EX", this.#memoryTtl)
      .sadd(indexKey, op.key)
      .expire(indexKey, this.#memoryTtl)
      .sadd(registryKey, namespaceTuple)
      .expire(registryKey, this.#memoryTtl)
      .exec();
  }

  async #search(op: Extract<Operation, { namespacePrefix: string[] }>): Promise<StoreSearchItem[]> {
    const prefix = op.namespacePrefix;
    const query = op.query?.toLocaleLowerCase();
    const limit = op.limit ?? 10;
    const offset = op.offset ?? 0;

    const all = await this.#listNamespaces({
      limit: Number.MAX_SAFE_INTEGER,
      matchConditions: [{ matchType: "prefix", path: prefix.length === 0 ? ["*"] : prefix }],
      offset: 0,
    });

    const items: StoreSearchItem[] = [];
    for (const ns of all) {
      const namespaceHash = hashNamespace(ns);
      const indexKey = this.#keys.memoryNamespaceIndex(namespaceHash);
      const keys = await this.#client.smembers(indexKey);
      if (keys.length === 0) continue;
      const itemKeys = keys.map((k) => this.#keys.memoryItem(namespaceHash, k));
      const raws = await this.#client.mget(...itemKeys);
      for (const raw of raws) {
        const record = itemCodec.decode(raw);
        if (!record) continue;
        if (!matchesFilter(record.value, op.filter)) continue;
        if (query && !textContentContains(record.value, query)) continue;
        items.push(toSearchItem(record));
      }
    }

    return items
      .sort((a, b) =>
        `${a.namespace.join(":")}:${a.key}`.localeCompare(`${b.namespace.join(":")}:${b.key}`),
      )
      .slice(offset, offset + limit);
  }

  async #listNamespaces(
    op: Extract<Operation, { limit: number; offset: number }>,
  ): Promise<string[][]> {
    const registryKey = this.#keys.memoryNamespaceRegistry();
    const tuples = await this.#client.smembers(registryKey);
    const namespaces = tuples
      .map((tuple): string[] => {
        try {
          return JSON.parse(tuple) as string[];
        } catch {
          return [];
        }
      })
      .filter((ns) => ns.length > 0)
      .filter((ns) => matchesNamespaceConditions(ns, op.matchConditions, op.maxDepth));

    const seen = new Set<string>();
    const deduped: string[][] = [];
    for (const ns of namespaces) {
      const truncated = op.maxDepth !== undefined ? ns.slice(0, op.maxDepth) : ns;
      const key = truncated.join("\u0000");
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(truncated);
      }
    }

    return deduped
      .sort((a, b) => a.join(":").localeCompare(b.join(":")))
      .slice(op.offset, op.offset + op.limit);
  }
}

function textContentContains(value: Record<string, unknown>, query: string): boolean {
  const text = readContent(value);
  return text.toLocaleLowerCase().includes(query);
}

function readContent(value: Record<string, unknown>): string {
  if (typeof value.content === "string") return value.content;
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function matchesFilter(value: Record<string, unknown>, filter?: Record<string, unknown>): boolean {
  if (!filter) return true;
  return Object.entries(filter).every(([k, expected]) => compareFilterValue(value[k], expected));
}

function compareFilterValue(actual: unknown, expected: unknown): boolean {
  if (!isOperatorFilter(expected)) return actual === expected;
  return Object.entries(expected).every(([op, operand]) => {
    switch (op) {
      case "$eq":
        return actual === operand;
      case "$ne":
        return actual !== operand;
      case "$gt":
        return comparable(actual) > comparable(operand);
      case "$gte":
        return comparable(actual) >= comparable(operand);
      case "$lt":
        return comparable(actual) < comparable(operand);
      case "$lte":
        return comparable(actual) <= comparable(operand);
      default:
        return false;
    }
  });
}

function isOperatorFilter(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function comparable(value: unknown): string | number {
  return typeof value === "number" ? value : String(value);
}

function matchesNamespaceConditions(
  namespace: string[],
  conditions: MatchCondition[] | undefined,
  _maxDepth: number | undefined,
): boolean {
  if (!conditions || conditions.length === 0) return true;
  return conditions.every((c) => {
    if (c.matchType === "prefix") return matchesPrefix(namespace, c.path);
    return matchesSuffix(namespace, c.path);
  });
}

function matchesPrefix(namespace: string[], prefix: readonly (string | "*")[]): boolean {
  if (prefix.length > namespace.length) return false;
  return prefix.every((p, i) => p === "*" || namespace[i] === p);
}

function matchesSuffix(namespace: string[], suffix: readonly (string | "*")[]): boolean {
  if (suffix.length > namespace.length) return false;
  return suffix.every((p, i) => {
    const idx = namespace.length - suffix.length + i;
    return p === "*" || namespace[idx] === p;
  });
}
