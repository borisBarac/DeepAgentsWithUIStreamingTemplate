import { describe, expect, it } from "bun:test";

import { InMemorySessionStore, RedisSessionStore } from "./store.ts";
import type { RunMetadata, SessionRecord } from "./types.ts";

const TENANT_A = { tenantId: "tenant-a", userId: "user-1" };
const TENANT_B = { tenantId: "tenant-b", userId: "user-1" };
const USER_A = { tenantId: "tenant-a", userId: "user-1" };
const USER_B = { tenantId: "tenant-a", userId: "user-2" };

const record = (text: string) => ({
  failure: null,
  history: [{ content: text, role: "user" }],
  structuredOutput: null,
});

describe("InMemorySessionStore", () => {
  it("isolates session history by tenant", () => {
    const store = new InMemorySessionStore();
    store.commitSession(TENANT_A, "s1", record("tenant-a-history"));
    store.commitSession(TENANT_B, "s1", record("tenant-b-history"));

    expect(store.loadSession(TENANT_A, "s1")?.history).toEqual([
      { content: "tenant-a-history", role: "user" },
    ]);
    expect(store.loadSession(TENANT_B, "s1")?.history).toEqual([
      { content: "tenant-b-history", role: "user" },
    ]);
  });

  it("isolates session history by user within a tenant", () => {
    const store = new InMemorySessionStore();
    store.commitSession(USER_A, "s1", record("user-1-history"));
    store.commitSession(USER_B, "s1", record("user-2-history"));

    expect(store.loadSession(USER_A, "s1")?.history).toEqual([
      { content: "user-1-history", role: "user" },
    ]);
    expect(store.loadSession(USER_B, "s1")?.history).toEqual([
      { content: "user-2-history", role: "user" },
    ]);
  });

  it("returns null for unknown sessions", () => {
    const store = new InMemorySessionStore();
    expect(store.loadSession(TENANT_A, "missing")).toBeNull();
  });

  it("commits replace prior state atomically", () => {
    const store = new InMemorySessionStore();
    store.commitSession(TENANT_A, "s1", record("first"));
    store.commitSession(TENANT_A, "s1", record("second"));
    expect(store.loadSession(TENANT_A, "s1")?.history).toEqual([
      { content: "second", role: "user" },
    ]);
  });

  it("records run metadata scoped by tenant, user, and session", () => {
    const store = new InMemorySessionStore();
    const meta = { finishedAt: 2, outcome: "success" as const, runId: "r1", startedAt: 1 };
    store.recordRun(TENANT_A, "s1", meta);
    expect(store.lastRun(TENANT_A, "s1")).toEqual(meta);
    expect(store.lastRun(TENANT_B, "s1")).toBeNull();
    expect(store.lastRun(TENANT_A, "other")).toBeNull();
  });

  it("round-trips complete session records and run metadata unchanged", () => {
    const store = new InMemorySessionStore();
    const session: SessionRecord = {
      failure: { attempts: 1, code: "invalid_model_output", issues: [] },
      history: [
        { content: "Question", role: "user" },
        { content: "Answer", role: "assistant" },
      ],
      structuredOutput: { version: 1, updates: [{ text: "Answer", type: "message" }] },
    };
    const run: RunMetadata = { finishedAt: 2, outcome: "failure", runId: "r1", startedAt: 1 };

    store.commitSession(TENANT_A, "s1", session);
    store.recordRun(TENANT_A, "s1", run);

    expect(store.loadSession(TENANT_A, "s1")).toEqual(session);
    expect(store.lastRun(TENANT_A, "s1")).toEqual(run);
  });

  it("bounds #sessions at MAX_SESSIONS via LRU eviction", () => {
    const store = new InMemorySessionStore();
    const cap = 100;
    for (let i = 0; i < cap + 5; i += 1) {
      store.commitSession({ tenantId: "t", userId: `u${i}` }, "s", record(`h${i}`));
    }
    // The first 5 entries (u0..u4) should have been evicted.
    for (let i = 0; i < 5; i += 1) {
      expect(store.loadSession({ tenantId: "t", userId: `u${i}` }, "s")).toBeNull();
    }
    // The most recent cap entries survive.
    expect(store.loadSession({ tenantId: "t", userId: `u${cap + 4}` }, "s")).not.toBeNull();
  });

  it("bounds #runs independently when recordRun is called without commitSession", () => {
    // Regression for the cancel/error path: AgentRequestRunner.#commit skips
    // commitSession on cancel/error but still calls recordRun. Without an
    // independent bound on #runs, sustained failures would grow #runs without
    // limit (contradicting the documented LRU contract).
    const store = new InMemorySessionStore();
    const cap = 100;
    for (let i = 0; i < cap + 5; i += 1) {
      store.recordRun({ tenantId: "t", userId: `u${i}` }, "s", {
        finishedAt: i,
        outcome: "error",
        runId: `r${i}`,
        startedAt: 0,
      });
    }
    // The first 5 entries should have been evicted from #runs.
    for (let i = 0; i < 5; i += 1) {
      expect(store.lastRun({ tenantId: "t", userId: `u${i}` }, "s")).toBeNull();
    }
    // The most recent entry survives.
    expect(store.lastRun({ tenantId: "t", userId: `u${cap + 4}` }, "s")).not.toBeNull();
  });
});

describe("RedisSessionStore", () => {
  it("constructs without connecting and rejects every operation", () => {
    const store = new RedisSessionStore({ keyPrefix: "session", url: "redis://unused" });
    const session = record("history");
    const run: RunMetadata = { finishedAt: 2, outcome: "success", runId: "r1", startedAt: 1 };
    const message = "RedisSessionStore is not implemented yet.";

    expect(() => store.loadSession(TENANT_A, "s1")).toThrow(message);
    expect(() => store.commitSession(TENANT_A, "s1", session)).toThrow(message);
    expect(() => store.recordRun(TENANT_A, "s1", run)).toThrow(message);
    expect(() => store.lastRun(TENANT_A, "s1")).toThrow(message);
  });
});
