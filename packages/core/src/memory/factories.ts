import { type BaseStore, InMemoryStore } from "@langchain/langgraph";
import type { StoreBackend } from "deepagents";

import { BucketMemoryStore, type BucketMemoryStoreOptions } from "./bucket-store.ts";
import { FileSystemMemoryStore, type FileSystemMemoryStoreOptions } from "./filesystem-store.ts";
import { createUserMemoryNamespace } from "./namespace.ts";
import { MemoryRepository } from "./repository.ts";
import { MemoryStoreBackend } from "./store-backend.ts";

export type CreateMemoryRepositoryFactoryOptions = {
  store: BaseStore;
  userId: string;
};

export type CreateUserMemoryBackendOptions = {
  store?: BaseStore;
  userId: string;
};

export function createInMemoryMemoryStore(): InMemoryStore {
  return new InMemoryStore();
}

export function createFileSystemMemoryStore(
  options: FileSystemMemoryStoreOptions,
): FileSystemMemoryStore {
  return new FileSystemMemoryStore(options);
}

export function createBucketMemoryStore(options: BucketMemoryStoreOptions = {}): BucketMemoryStore {
  return new BucketMemoryStore(options);
}

export function createMemoryRepository(
  options: CreateMemoryRepositoryFactoryOptions,
): MemoryRepository {
  return new MemoryRepository(options);
}

export function createUserMemoryBackend(options: CreateUserMemoryBackendOptions): StoreBackend {
  return new MemoryStoreBackend({
    store: options.store,
    namespace: createUserMemoryNamespace(options.userId),
  });
}
