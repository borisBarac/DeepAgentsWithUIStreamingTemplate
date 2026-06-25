import { describe, expect, it } from "bun:test";
import { CompositeBackend, StateBackend, StoreBackend } from "deepagents";
import {
  createInMemoryMemoryStore,
  createMemoryRepository,
  createUserMemoryNamespace,
} from "../memory/index.ts";
import { createDefaultCompositeBackend } from "./backend.ts";
import { DEFAULT_MEMORY_ROOT, DEFAULT_PROJECT_FACTS_PATH } from "./constants.ts";

describe("composite backend defaults", () => {
  it("wires state and memory backends together", () => {
    const backend = createDefaultCompositeBackend();

    expect(backend).toBeInstanceOf(CompositeBackend);
    expect(backend.routePrefixes).toEqual([`${DEFAULT_MEMORY_ROOT}/`]);
  });

  it("respects explicit backend overrides", () => {
    const defaultBackend = new StateBackend();
    const memoryBackend = new StoreBackend();

    const backend = createDefaultCompositeBackend({
      defaultBackend,
      memoryBackend,
    });

    expect(backend).toBeInstanceOf(CompositeBackend);
    expect(backend.routePrefixes).toEqual([`${DEFAULT_MEMORY_ROOT}/`]);
  });

  it("uses the user memory backend factory for default memory routes", async () => {
    const store = createInMemoryMemoryStore();
    const namespace = createUserMemoryNamespace("alice@example.com");
    const backend = createDefaultCompositeBackend({
      memoryStore: store,
      memoryUserId: "alice@example.com",
    });

    const result = await backend.write("/memory/project-facts.md", "Backend memory");

    expect(result.error).toBeUndefined();
    expect((await store.search(namespace)).map((item) => item.value.content)).toEqual([
      "Backend memory",
    ]);
  });

  it("keeps explicit memoryNamespace ahead of memoryUserId", async () => {
    const store = createInMemoryMemoryStore();
    const backend = createDefaultCompositeBackend({
      memoryStore: store,
      memoryNamespace: ["custom-user"],
      memoryUserId: "alice@example.com",
    });

    await backend.write("/memory/project-facts.md", "Custom namespace memory");

    expect((await store.search(["custom-user"])).map((item) => item.value.content)).toEqual([
      "Custom namespace memory",
    ]);
    expect(await store.search(createUserMemoryNamespace("alice@example.com"))).toEqual([]);
  });

  it("keeps explicit memoryBackend ahead of generated backends", async () => {
    const store = createInMemoryMemoryStore();
    const memoryBackend = new StoreBackend({ store, namespace: ["explicit-backend"] });
    const backend = createDefaultCompositeBackend({
      memoryBackend,
      memoryStore: store,
      memoryNamespace: ["custom-user"],
      memoryUserId: "alice@example.com",
    });

    await backend.write("/memory/project-facts.md", "Explicit backend memory");

    expect((await store.search(["explicit-backend"])).map((item) => item.value.content)).toEqual([
      "Explicit backend memory",
    ]);
    expect(await store.search(["custom-user"])).toEqual([]);
    expect(await store.search(createUserMemoryNamespace("alice@example.com"))).toEqual([]);
  });

  it("shares the same key space as the memory repository", async () => {
    const store = createInMemoryMemoryStore();
    const userId = "alice@example.com";
    const repo = createMemoryRepository({ store, userId });
    const backend = createDefaultCompositeBackend({ memoryStore: store, memoryUserId: userId });

    await repo.upsert(DEFAULT_PROJECT_FACTS_PATH, "repo-seeded");

    const readBack = await backend.read(DEFAULT_PROJECT_FACTS_PATH);
    expect("content" in readBack ? readBack.content : "").toContain("repo-seeded");

    await backend.write("/memory/notes.md", "backend-written");
    expect(await repo.read("/memory/notes.md")).toBe("backend-written");
  });
});
