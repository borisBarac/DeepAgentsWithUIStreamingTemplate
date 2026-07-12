import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  BaseStore,
  type Item,
  type MatchCondition,
  type Operation,
  type OperationResults,
  type PutOperation,
} from "@langchain/langgraph";

import { normalizeVirtualPath } from "./repository.ts";
import { stringOrFallback } from "./string-or-fallback.ts";

export type FileSystemMemoryStoreOptions = {
  rootDir: string;
};

type StoredMetadata = {
  namespace: string[];
  key: string;
  createdAt: string;
  updatedAt: string;
  value: Record<string, unknown>;
};

type StoreSearchItem = Item & { score?: number };

const NAMESPACE_PART_PATTERN = /^[-A-Za-z0-9._@+:~]+$/;

export class FileSystemMemoryStore extends BaseStore {
  readonly rootDir: string;

  constructor(options: FileSystemMemoryStoreOptions) {
    super();
    this.rootDir = path.resolve(options.rootDir);
  }

  override async batch<Op extends Operation[]>(operations: Op): Promise<OperationResults<Op>> {
    const results: unknown[] = [];

    for (const operation of operations) {
      if ("namespacePrefix" in operation) {
        results.push(await this.searchOperation(operation));
      } else if ("value" in operation) {
        await this.putOperation(operation);
        results.push(undefined);
      } else if ("key" in operation && "namespace" in operation) {
        results.push(await this.getOperation(operation.namespace, operation.key));
      } else if ("matchConditions" in operation) {
        results.push(await this.listNamespacesOperation(operation));
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
    index?: false | string[],
  ): Promise<void> {
    await this.batch([{ namespace, key, value, index }]);
  }

  override async delete(namespace: string[], key: string): Promise<void> {
    await this.batch([{ namespace, key, value: null }]);
  }

  private async getOperation(namespace: string[], key: string): Promise<Item | null> {
    const filePath = this.resolveItemFilePath(namespace, key);

    try {
      const [content, metadata] = await Promise.all([
        readFile(filePath, "utf8"),
        this.readMetadata(filePath),
      ]);
      return this.toItem(content, metadata);
    } catch (error) {
      if (isNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }

  private async putOperation(operation: PutOperation): Promise<void> {
    const filePath = this.resolveItemFilePath(operation.namespace, operation.key);

    if (operation.value === null) {
      await Promise.all([
        rm(filePath, { force: true }),
        rm(metadataPath(filePath), { force: true }),
      ]);
      return;
    }

    if (typeof operation.value.content !== "string") {
      throw new Error(`FileSystemMemoryStore only supports string content: ${operation.key}`);
    }

    const existing = await this.getOperation(operation.namespace, operation.key);
    const now = new Date().toISOString();
    const createdAt = existing?.createdAt.toISOString() ?? now;
    const value = {
      ...operation.value,
      content: undefined,
    };
    delete value.content;

    await mkdir(path.dirname(filePath), { recursive: true });
    await Promise.all([
      writeFile(filePath, operation.value.content, "utf8"),
      writeFile(
        metadataPath(filePath),
        `${JSON.stringify(
          {
            namespace: operation.namespace,
            key: operation.key,
            createdAt,
            updatedAt: now,
            value,
          } satisfies StoredMetadata,
          null,
          2,
        )}\n`,
        "utf8",
      ),
    ]);
  }

  private async searchOperation(operation: Extract<Operation, { namespacePrefix: string[] }>) {
    assertSafeNamespace(operation.namespacePrefix);

    const query = operation.query?.toLocaleLowerCase();
    const items = (await this.readAllItems())
      .filter((item) => namespaceStartsWith(item.namespace, operation.namespacePrefix))
      .filter((item) => matchesFilter(item.value, operation.filter));

    const filteredItems = query
      ? items.filter((item) => readContent(item).toLocaleLowerCase().includes(query))
      : items;

    return filteredItems
      .sort(compareItems)
      .slice(operation.offset ?? 0, (operation.offset ?? 0) + (operation.limit ?? 10))
      .map((item) => ({ ...item, score: undefined }) satisfies StoreSearchItem);
  }

  private async listNamespacesOperation(
    operation: Extract<Operation, { limit: number; offset: number }>,
  ) {
    const namespaceKeys = new Set<string>();
    const namespaces: string[][] = [];

    const matchedItems = (await this.readAllItems()).filter((item) =>
      matchesNamespaceConditions(item.namespace, operation.matchConditions),
    );

    for (const item of matchedItems) {
      const namespace =
        operation.maxDepth === undefined
          ? item.namespace
          : item.namespace.slice(0, operation.maxDepth);
      const namespaceKey = namespace.join("\0");
      if (!namespaceKeys.has(namespaceKey)) {
        namespaceKeys.add(namespaceKey);
        namespaces.push(namespace);
      }
    }

    return namespaces
      .sort((a, b) => a.join(":").localeCompare(b.join(":")))
      .slice(
        operation.offset ?? 0,
        (operation.offset ?? 0) + (operation.limit ?? namespaces.length),
      );
  }

  private async readAllItems(): Promise<Item[]> {
    const files = await listFiles(this.rootDir);
    const items: Item[] = [];

    for (const filePath of files) {
      if (filePath.endsWith(".meta.json")) {
        continue;
      }

      try {
        const [content, metadata] = await Promise.all([
          readFile(filePath, "utf8"),
          this.readMetadata(filePath),
        ]);
        items.push(this.toItem(content, metadata));
      } catch (error) {
        if (!isNotFoundError(error)) {
          throw error;
        }
      }
    }

    return items;
  }

  private async readMetadata(filePath: string): Promise<StoredMetadata> {
    const content = await readFile(metadataPath(filePath), "utf8");
    return JSON.parse(content) as StoredMetadata;
  }

  private toItem(content: string, metadata: StoredMetadata): Item {
    return {
      key: metadata.key,
      namespace: metadata.namespace,
      value: {
        ...metadata.value,
        content,
        created_at: stringOrFallback(metadata.value.created_at, metadata.createdAt),
        modified_at: stringOrFallback(metadata.value.modified_at, metadata.updatedAt),
      },
      createdAt: new Date(metadata.createdAt),
      updatedAt: new Date(metadata.updatedAt),
    };
  }

  private resolveItemFilePath(namespace: string[], key: string): string {
    assertSafeNamespace(namespace);
    const normalizedKey = normalizeVirtualPath(key);
    const keySegments = normalizedKey.slice(1).split("/");
    const filePath = path.resolve(this.rootDir, ...namespace, ...keySegments);
    assertWithinRoot(this.rootDir, filePath);
    return filePath;
  }
}

async function listFiles(rootDir: string): Promise<string[]> {
  try {
    const rootStat = await stat(rootDir);
    if (!rootStat.isDirectory()) {
      return [];
    }
  } catch (error) {
    if (isNotFoundError(error)) {
      return [];
    }
    throw error;
  }

  const entries = await readdir(rootDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(entryPath)));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

function metadataPath(filePath: string): string {
  return `${filePath}.meta.json`;
}

function assertSafeNamespace(namespace: string[]): void {
  if (namespace.length === 0) {
    throw new Error("Namespace cannot be empty.");
  }
  for (const part of namespace) {
    if (part === "." || part === "..") {
      throw new Error(`Unsafe namespace component: ${part}`);
    }
    if (!NAMESPACE_PART_PATTERN.test(part)) {
      throw new Error(`Unsafe namespace component: ${part}`);
    }
  }
}

function assertWithinRoot(rootDir: string, filePath: string): void {
  const relativePath = path.relative(rootDir, filePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`Resolved memory path escapes root: ${filePath}`);
  }
}

function namespaceStartsWith(namespace: string[], prefix: string[]): boolean {
  if (prefix.length > namespace.length) {
    return false;
  }
  return prefix.every((part, index) => namespace[index] === part);
}

function matchesFilter(value: Record<string, unknown>, filter?: Record<string, unknown>): boolean {
  if (!filter) {
    return true;
  }

  return Object.entries(filter).every(([key, expected]) =>
    compareFilterValue(value[key], expected),
  );
}

function compareFilterValue(actual: unknown, expected: unknown): boolean {
  if (!isOperatorFilter(expected)) {
    return actual === expected;
  }

  return Object.entries(expected).every(([operator, operand]) => {
    switch (operator) {
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
  if (!conditions || conditions.length === 0) {
    return true;
  }

  return conditions.every((condition) => {
    if (condition.matchType === "prefix") {
      return matchesNamespacePrefix(namespace, condition.path);
    }
    return matchesNamespaceSuffix(namespace, condition.path);
  });
}

function matchesNamespacePrefix(namespace: string[], prefix: readonly (string | "*")[]): boolean {
  if (prefix.length > namespace.length) {
    return false;
  }
  return prefix.every((part, index) => part === "*" || namespace[index] === part);
}

function matchesNamespaceSuffix(namespace: string[], suffix: readonly (string | "*")[]): boolean {
  if (suffix.length > namespace.length) {
    return false;
  }
  return suffix.every((part, index) => {
    const namespaceIndex = namespace.length - suffix.length + index;
    return part === "*" || namespace[namespaceIndex] === part;
  });
}

function compareItems(a: Item, b: Item): number {
  return `${a.namespace.join(":")}:${a.key}`.localeCompare(`${b.namespace.join(":")}:${b.key}`);
}

function readContent(item: Item): string {
  if (typeof item.value.content !== "string") {
    throw new Error(`FileSystemMemoryStore only supports string content: ${item.key}`);
  }
  return item.value.content;
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
