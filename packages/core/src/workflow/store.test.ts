import { describe, expect, it } from "bun:test";
import { InMemoryStore } from "@langchain/langgraph";

import { createWorkflowState } from "./reducer.ts";
import { BaseStoreWorkflowStateStore, InMemoryWorkflowStateStore } from "./store.ts";

describe("InMemoryWorkflowStateStore", () => {
  it("creates, loads, updates, deletes archived state, and isolates state by thread", async () => {
    const store = new InMemoryWorkflowStateStore();
    const initial = createWorkflowState("First request");
    const updated = { ...initial, phase: "waiting_for_user" as const };
    const other = createWorkflowState("Second request");

    await store.save("first", initial);
    await store.save("second", other);
    expect(await store.load("first")).toBe(initial);
    expect(await store.load("second")).toBe(other);

    await store.save("first", updated);
    expect(await store.load("first")).toBe(updated);

    await store.archive("first");
    expect(await store.load("first")).toBeUndefined();
    expect(await store.load("second")).toBe(other);
  });
});

describe("BaseStoreWorkflowStateStore", () => {
  it("returns undefined before any state is saved", async () => {
    const store = new BaseStoreWorkflowStateStore(new InMemoryStore());
    expect(await store.load("thread-1")).toBeUndefined();
  });

  it("persists state that a subsequent load returns", async () => {
    const baseStore = new InMemoryStore();
    const store = new BaseStoreWorkflowStateStore(baseStore);
    const state = createWorkflowState("Build a kanban board");

    await store.save("thread-1", state);
    const loaded = await store.load("thread-1");

    expect(loaded).toEqual(state);
    // And the raw BaseStore holds it under the documented namespace/key.
    const raw = await baseStore.get(["agent-workflow", "thread-1"], "active");
    expect(raw?.value).toEqual(state);
  });

  it("overwrites active state on re-save", async () => {
    const store = new BaseStoreWorkflowStateStore(new InMemoryStore());
    const initial = createWorkflowState("First request");
    const updated = { ...initial, phase: "execution" as const };

    await store.save("thread-1", initial);
    await store.save("thread-1", updated);
    expect(await store.load("thread-1")).toEqual(updated);
  });

  it("makes load return undefined after archiving", async () => {
    const baseStore = new InMemoryStore();
    const store = new BaseStoreWorkflowStateStore(baseStore);
    const state = createWorkflowState("Archive me");

    await store.save("thread-1", state);
    expect(await store.load("thread-1")).toEqual(state);

    await store.archive("thread-1");
    expect(await store.load("thread-1")).toBeUndefined();
    // The archived snapshot is retained under the archive namespace.
    const archived = await baseStore.search(["agent-workflow", "thread-1", "archive"], {
      limit: 10,
    });
    expect(archived).toHaveLength(1);
    expect(archived[0]?.value).toEqual(state);
  });

  it("shares state across instances wrapping the same BaseStore (cross-rebuild contract)", async () => {
    // A worker rebuilds the agent (new controller, new store adapter) but
    // shares the same BaseStore — the rebuilt controller must see the workflow
    // state the original wrote, so it resumes instead of restarting.
    const sharedBaseStore = new InMemoryStore();
    const firstController = new BaseStoreWorkflowStateStore(sharedBaseStore);
    const state = createWorkflowState("Long-running workflow");

    await firstController.save("thread-1", state);

    const rebuiltController = new BaseStoreWorkflowStateStore(sharedBaseStore);
    expect(await rebuiltController.load("thread-1")).toEqual(state);

    // Archiving from the rebuilt instance also clears it for the original.
    await rebuiltController.archive("thread-1");
    expect(await firstController.load("thread-1")).toBeUndefined();
  });

  it("isolates state by thread id", async () => {
    const store = new BaseStoreWorkflowStateStore(new InMemoryStore());
    const first = createWorkflowState("First request");
    const second = createWorkflowState("Second request");

    await store.save("thread-1", first);
    await store.save("thread-2", second);
    expect(await store.load("thread-1")).toEqual(first);
    expect(await store.load("thread-2")).toEqual(second);

    await store.archive("thread-1");
    expect(await store.load("thread-1")).toBeUndefined();
    expect(await store.load("thread-2")).toEqual(second);
  });
});
