import type { BaseStore, Item, Operation, OperationResults } from "@langchain/langgraph";

import { createUserMemoryNamespace } from "./namespace.ts";

export type MemoryFileInfo = {
  path: string;
  isDirectory: boolean;
  size?: number;
  modifiedAt?: string;
};

export type MemorySearchResult = {
  path: string;
  content: string;
  createdAt: string;
  modifiedAt: string;
};

export type CreateMemoryRepositoryOptions = {
  store: BaseStore;
  userId?: string;
};

type MemoryStoreValue = {
  content: string;
  created_at: string;
  modified_at: string;
  mimeType: "text/markdown";
};

type StoreSearchItem = Item & { score?: number };

const SEARCH_PAGE_SIZE = 100;

export class MemoryRepository {
  readonly namespace: string[];
  readonly store: BaseStore;

  constructor(options: CreateMemoryRepositoryOptions) {
    this.store = options.store;
    this.namespace = createUserMemoryNamespace(options.userId);
  }

  async read(path: string): Promise<string | null> {
    const normalizedPath = normalizeVirtualPath(path);
    const item = await this.get(normalizedPath);
    if (!item) {
      return null;
    }
    return readStringContent(item.value, normalizedPath);
  }

  async write(path: string, content: string): Promise<void> {
    const normalizedPath = normalizeVirtualPath(path);
    assertStringContent(content);

    const existing = await this.get(normalizedPath);
    if (existing) {
      throw new Error(`Memory file already exists: ${normalizedPath}`);
    }

    await this.put(normalizedPath, createStoreValue(content));
  }

  async update(path: string, content: string): Promise<void> {
    const normalizedPath = normalizeVirtualPath(path);
    assertStringContent(content);

    const existing = await this.get(normalizedPath);
    if (!existing) {
      throw new Error(`Memory file does not exist: ${normalizedPath}`);
    }

    const now = new Date().toISOString();
    const createdAt = stringOrFallback(existing.value.created_at, existing.createdAt.toISOString());
    await this.put(normalizedPath, {
      content,
      created_at: createdAt,
      modified_at: now,
      mimeType: "text/markdown",
    });
  }

  async upsert(path: string, content: string): Promise<void> {
    const normalizedPath = normalizeVirtualPath(path);
    assertStringContent(content);

    const existing = await this.get(normalizedPath);
    if (!existing) {
      await this.put(normalizedPath, createStoreValue(content));
      return;
    }

    const now = new Date().toISOString();
    const createdAt = stringOrFallback(existing.value.created_at, existing.createdAt.toISOString());
    await this.put(normalizedPath, {
      content,
      created_at: createdAt,
      modified_at: now,
      mimeType: "text/markdown",
    });
  }

  async delete(path: string): Promise<void> {
    const normalizedPath = normalizeVirtualPath(path);
    await this.batch([{ namespace: this.namespace, key: normalizedPath, value: null }]);
  }

  async search(rootPath: string, query: string): Promise<MemorySearchResult[]> {
    const normalizedRoot = normalizeVirtualPath(rootPath);
    const normalizedQuery = query.toLocaleLowerCase();
    const items = await this.searchAll();

    return items
      .filter((item) => isUnderVirtualRoot(item.key, normalizedRoot))
      .map((item) => ({ item, content: readStringContent(item.value, item.key) }))
      .filter(({ content }) => content.toLocaleLowerCase().includes(normalizedQuery))
      .map(({ item, content }) => ({
        path: item.key,
        content,
        createdAt: stringOrFallback(item.value.created_at, item.createdAt.toISOString()),
        modifiedAt: stringOrFallback(item.value.modified_at, item.updatedAt.toISOString()),
      }));
  }

  async list(rootPath: string): Promise<MemoryFileInfo[]> {
    const normalizedRoot = normalizeVirtualPath(rootPath);
    const items = await this.searchAll();
    const children = new Map<string, MemoryFileInfo>();

    for (const item of items) {
      if (!isUnderVirtualRoot(item.key, normalizedRoot)) {
        continue;
      }

      const relativePath = item.key.slice(`${normalizedRoot}/`.length);
      const [firstSegment, ...remainingSegments] = relativePath.split("/");
      if (!firstSegment) {
        continue;
      }

      if (remainingSegments.length > 0) {
        const directoryPath = `${normalizedRoot}/${firstSegment}/`;
        children.set(directoryPath, { path: directoryPath, isDirectory: true });
        continue;
      }

      const content = readStringContent(item.value, item.key);
      children.set(item.key, {
        path: item.key,
        isDirectory: false,
        size: content.length,
        modifiedAt: stringOrFallback(item.value.modified_at, item.updatedAt.toISOString()),
      });
    }

    return [...children.values()].sort((a, b) => a.path.localeCompare(b.path));
  }

  private async get(key: string): Promise<StoreSearchItem | null> {
    const [item] = await this.batch([{ namespace: this.namespace, key }]);
    return item as StoreSearchItem | null;
  }

  private async put(key: string, value: MemoryStoreValue): Promise<void> {
    await this.batch([{ namespace: this.namespace, key, value }]);
  }

  private async searchAll(): Promise<StoreSearchItem[]> {
    const items: StoreSearchItem[] = [];
    let offset = 0;

    while (true) {
      const [page] = await this.batch([
        { namespacePrefix: this.namespace, limit: SEARCH_PAGE_SIZE, offset },
      ]);
      const pageItems = page as StoreSearchItem[];
      items.push(...pageItems);

      if (pageItems.length < SEARCH_PAGE_SIZE) {
        break;
      }
      offset += SEARCH_PAGE_SIZE;
    }

    return items.sort((a, b) => a.key.localeCompare(b.key));
  }

  private async batch<Op extends Operation[]>(operations: Op): Promise<OperationResults<Op>> {
    return this.store.batch(operations);
  }
}

export function normalizeVirtualPath(path: string): string {
  if (!path.startsWith("/")) {
    throw new Error(`Memory paths must be absolute virtual paths: ${path}`);
  }
  if (path === "/") {
    throw new Error("Memory path cannot be '/'.");
  }
  if (path.includes("\\")) {
    throw new Error(`Memory path cannot contain backslashes: ${path}`);
  }

  const segments = path.slice(1).split("/");
  if (segments.some((segment) => segment === "")) {
    throw new Error(`Memory path cannot contain empty segments: ${path}`);
  }
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error(`Memory path cannot contain traversal segments: ${path}`);
  }

  return `/${segments.join("/")}`;
}

function createStoreValue(content: string): MemoryStoreValue {
  const now = new Date().toISOString();
  return {
    content,
    created_at: now,
    modified_at: now,
    mimeType: "text/markdown",
  };
}

function readStringContent(value: Record<string, unknown>, path: string): string {
  if (typeof value.content !== "string") {
    throw new Error(`Memory file content must be a string: ${path}`);
  }
  return value.content;
}

function assertStringContent(content: string): void {
  if (typeof content !== "string") {
    throw new Error("Memory content must be a string.");
  }
}

function stringOrFallback(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function isUnderVirtualRoot(path: string, rootPath: string): boolean {
  return path.startsWith(`${rootPath}/`);
}
