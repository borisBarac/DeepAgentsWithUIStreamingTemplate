import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import type { WorkflowState } from "@deep-agent-template/core";
import { createWorkflowState } from "@deep-agent-template/core";
import { FakeRedis } from "./fake-redis.ts";
import { RedisWorkflowStateStore } from "./redis-workflow-state-store.ts";

describe("RedisWorkflowStateStore", () => {
  let client: FakeRedis;

  beforeEach(() => {
    client = new FakeRedis();
  });

  afterEach(() => {
    client._clear();
  });

  it("returns undefined when no state is stored for the thread", async () => {
    const store = new RedisWorkflowStateStore({ client: client.asRedis(), keyPrefix: "dat:" });
    expect(await store.load("thread-1")).toBeUndefined();
  });

  it("saves and loads workflow state by threadId", async () => {
    const store = new RedisWorkflowStateStore({ client: client.asRedis(), keyPrefix: "dat:" });
    const state: WorkflowState = createWorkflowState("First request");
    await store.save("thread-1", state);
    const loaded = await store.load("thread-1");
    expect(loaded).toEqual(state);
  });

  it("overwrites state on subsequent saves for the same thread", async () => {
    const store = new RedisWorkflowStateStore({ client: client.asRedis(), keyPrefix: "dat:" });
    const first = createWorkflowState("First");
    const second = { ...createWorkflowState("Second"), phase: "waiting_for_user" as const };
    await store.save("thread-1", first);
    await store.save("thread-1", second);
    expect(await store.load("thread-1")).toEqual(second);
  });

  it("isolates state across threads", async () => {
    const store = new RedisWorkflowStateStore({ client: client.asRedis(), keyPrefix: "dat:" });
    const a = createWorkflowState("A");
    const b = createWorkflowState("B");
    await store.save("thread-a", a);
    await store.save("thread-b", b);
    expect(await store.load("thread-a")).toEqual(a);
    expect(await store.load("thread-b")).toEqual(b);
  });

  it("archive removes the stored state for the thread", async () => {
    const store = new RedisWorkflowStateStore({ client: client.asRedis(), keyPrefix: "dat:" });
    const state = createWorkflowState("Hi");
    await store.save("thread-1", state);
    await store.archive("thread-1");
    expect(await store.load("thread-1")).toBeUndefined();
  });

  it("persists state under the configured keyPrefix", async () => {
    const store = new RedisWorkflowStateStore({
      client: client.asRedis(),
      keyPrefix: "alpha:",
    });
    await store.save("thread-1", createWorkflowState("Hi"));
    const keys = [...client._entries().keys()];
    expect(keys).toContain("alpha:workflow:thread-1");
  });
});
