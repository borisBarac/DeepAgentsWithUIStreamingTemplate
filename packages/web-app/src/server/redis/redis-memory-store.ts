import {
  BaseStore,
  type Item,
  type MatchCondition,
  type Operation,
  type OperationResults,
  type PutOperation,
} from "@langchain/langgraph";
import type { Redis } from "ioredis";

import { GUEST_STATE_TTL_SECONDS } from "../guest-identity.ts";
import { MEMORY_ITEM_SCHEMA_VERSION, type MemoryItemRecord, RedisCodec } from "./codec.ts";
import { createRedisKeys, hashNamespace, type RedisKeyspaces } from "./keys.ts";

// Redis-backed BaseStore for guest-scoped agent memory. Mirrors the
// FileSystemMemoryStore contract while persisting each guest namespace in Redis.
//
// Layout:
//   {prefix}memory:item:{namespaceHash}:{keyHash}  -> JSON record (string)
//   {prefix}memory:idx:{namespaceHash}             -> SET of keys (index)
//   {prefix}memory:namespaces                      -> SET of namespace tuples
//
// Guest namespace metadata starts one absolute TTL. Item/index keys inherit the
// remaining TTL; the global namespace registry is intentionally non-expiring.

const itemCodec = new RedisCodec<MemoryItemRecord>(MEMORY_ITEM_SCHEMA_VERSION);

type StoreSearchItem = Item;

export type RedisMemoryStoreOptions = {
  readonly client: Redis;
  readonly keyPrefix: string;
  readonly namespaceTtlSeconds?: number;
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

function decodeItem(raw: string | null): MemoryItemRecord | null {
  try {
    const record = itemCodec.decode(raw);
    if (!record || !isMemoryItemRecord(record)) return null;
    return record;
  } catch {
    return null;
  }
}

function isMemoryItemRecord(value: unknown): value is MemoryItemRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<MemoryItemRecord>;
  return (
    typeof record.key === "string" &&
    Array.isArray(record.namespace) &&
    record.namespace.every((part) => typeof part === "string") &&
    !!record.value &&
    typeof record.value === "object" &&
    !Array.isArray(record.value) &&
    typeof record.createdAt === "string" &&
    !Number.isNaN(new Date(record.createdAt).getTime()) &&
    typeof record.updatedAt === "string" &&
    !Number.isNaN(new Date(record.updatedAt).getTime())
  );
}

export class RedisMemoryStore extends BaseStore {
  readonly #client: Redis;
  readonly #keys: RedisKeyspaces;
  readonly #namespaceTtlSeconds: number;

  constructor(options: RedisMemoryStoreOptions) {
    super();
    this.#client = options.client;
    this.#keys = createRedisKeys(options.keyPrefix);
    this.#namespaceTtlSeconds = options.namespaceTtlSeconds ?? GUEST_STATE_TTL_SECONDS;
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
    const remaining = await this.#namespaceTtl(namespaceHash, false);
    if (remaining === null) return null;
    const itemKey = this.#keys.memoryItem(namespaceHash, key);
    const raw = await this.#client.get(itemKey);
    const record = decodeItem(raw);
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
    const existing = decodeItem(existingRaw);
    const record = toStoredRecord(namespace, op.key, op.value, existing);
    const encoded = itemCodec.encode(record);
    const namespaceTuple = JSON.stringify(namespace);
    const remaining = await this.#namespaceTtl(namespaceHash, true);
    if (remaining === null) return;

    await this.#client
      .multi()
      .set(itemKey, encoded, "EX", remaining)
      .sadd(indexKey, op.key)
      .expire(indexKey, remaining)
      .sadd(registryKey, namespaceTuple)
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
        const record = decodeItem(raw);
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
    const namespaces = (
      await Promise.all(
        tuples.map(async (tuple) => {
          const namespace = parseNamespace(tuple);
          if (!namespace) return null;
          const namespaceHash = hashNamespace(namespace);
          const remaining = await this.#namespaceTtl(namespaceHash, false);
          if (remaining === null) {
            await this.#pruneNamespace(namespaceHash, tuple);
            return null;
          }
          const keys = await this.#client.smembers(this.#keys.memoryNamespaceIndex(namespaceHash));
          if (keys.length === 0) {
            await this.#pruneNamespace(namespaceHash, tuple);
            return null;
          }
          const records = await this.#client.mget(
            ...keys.map((key) => this.#keys.memoryItem(namespaceHash, key)),
          );
          if (!records.some((raw) => decodeItem(raw))) {
            await this.#pruneNamespace(namespaceHash, tuple);
            return null;
          }
          return namespace;
        }),
      )
    )
      .filter((namespace): namespace is string[] => namespace !== null)
      .map((tuple): string[] => {
        return tuple;
      })
      .filter((ns) => matchesNamespaceConditions(ns, op.matchConditions));

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

  async #namespaceTtl(namespaceHash: string, create: boolean): Promise<number | null> {
    const expiryKey = this.#keys.memoryNamespaceExpiry(namespaceHash);
    if (create) {
      await (this.#client.set as unknown as (...args: unknown[]) => Promise<unknown>)(
        expiryKey,
        "1",
        "EX",
        this.#namespaceTtlSeconds,
        "NX",
      );
    }
    const pttl = await this.#client.pttl(expiryKey);
    if (pttl <= 0) return null;
    return Math.max(1, Math.ceil(pttl / 1_000));
  }

  async #pruneNamespace(namespaceHash: string, tuple: string): Promise<void> {
    await this.#client
      .multi()
      .srem(this.#keys.memoryNamespaceRegistry(), tuple)
      .del(
        this.#keys.memoryNamespaceIndex(namespaceHash),
        this.#keys.memoryNamespaceExpiry(namespaceHash),
      )
      .exec();
  }
}

function parseNamespace(value: string): string[] | null {
  try {
    const namespace = JSON.parse(value) as unknown;
    return Array.isArray(namespace) &&
      namespace.length > 0 &&
      namespace.every((part) => typeof part === "string")
      ? namespace
      : null;
  } catch {
    return null;
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
