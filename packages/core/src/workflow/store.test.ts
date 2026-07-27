import { describe, expect, it } from "bun:test";

import { createWorkflowState } from "./reducer.ts";
import { InMemoryWorkflowStateStore, RedisWorkflowStateStore } from "./store.ts";

describe("InMemoryWorkflowStateStore", () => {
  it("creates, loads, updates, archives, and isolates state by thread", () => {
    const store = new InMemoryWorkflowStateStore();
    const initial = createWorkflowState("First request");
    const updated = { ...initial, phase: "waiting_for_user" as const };
    const other = createWorkflowState("Second request");

    store.save("first", initial);
    store.save("second", other);
    expect(store.load("first")).toBe(initial);
    expect(store.load("second")).toBe(other);

    store.save("first", updated);
    expect(store.load("first")).toBe(updated);

    store.archive("first", updated);
    expect(store.load("first")).toBeUndefined();
    expect(store.load("second")).toBe(other);
  });
});

describe("RedisWorkflowStateStore", () => {
  it("constructs without connecting and rejects every operation", () => {
    const store = new RedisWorkflowStateStore({ keyPrefix: "workflow", url: "redis://unused" });
    const state = createWorkflowState("Request");
    const message = "RedisWorkflowStateStore is not implemented yet.";

    expect(() => store.load("thread")).toThrow(message);
    expect(() => store.save("thread", state)).toThrow(message);
    expect(() => store.archive("thread", state)).toThrow(message);
  });
});
