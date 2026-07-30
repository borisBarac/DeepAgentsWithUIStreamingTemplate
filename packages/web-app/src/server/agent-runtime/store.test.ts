import { describe, expect, it } from "bun:test";

import { InMemorySessionStore } from "./store.ts";
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
  it("isolates session history by tenant", async () => {
    const store = new InMemorySessionStore();
    await store.commitSession(TENANT_A, "s1", record("tenant-a-history"), 0);
    await store.commitSession(TENANT_B, "s1", record("tenant-b-history"), 0);

    expect((await store.loadSession(TENANT_A, "s1")).record?.history).toEqual([
      { content: "tenant-a-history", role: "user" },
    ]);
    expect((await store.loadSession(TENANT_B, "s1")).record?.history).toEqual([
      { content: "tenant-b-history", role: "user" },
    ]);
  });

  it("isolates session history by user within a tenant", async () => {
    const store = new InMemorySessionStore();
    await store.commitSession(USER_A, "s1", record("user-1-history"), 0);
    await store.commitSession(USER_B, "s1", record("user-2-history"), 0);

    expect((await store.loadSession(USER_A, "s1")).record?.history).toEqual([
      { content: "user-1-history", role: "user" },
    ]);
    expect((await store.loadSession(USER_B, "s1")).record?.history).toEqual([
      { content: "user-2-history", role: "user" },
    ]);
  });

  it("returns null for unknown sessions", async () => {
    const store = new InMemorySessionStore();
    expect((await store.loadSession(TENANT_A, "missing")).record).toBeNull();
  });

  it("commits replace prior state when the expected version matches", async () => {
    const store = new InMemorySessionStore();
    expect(await store.commitSession(TENANT_A, "s1", record("first"), 0)).toBe(true);
    const loaded = await store.loadSession(TENANT_A, "s1");
    expect(await store.commitSession(TENANT_A, "s1", record("second"), loaded.version)).toBe(true);
    expect((await store.loadSession(TENANT_A, "s1")).record?.history).toEqual([
      { content: "second", role: "user" },
    ]);
  });

  it("rejects commits when the expected version is stale", async () => {
    const store = new InMemorySessionStore();
    await store.commitSession(TENANT_A, "s1", record("first"), 0);
    // A concurrent commit bumped the version to 1; a stale writer using 0 fails.
    await store.commitSession(TENANT_A, "s1", record("interloper"), 1);
    expect(await store.commitSession(TENANT_A, "s1", record("stale"), 0)).toBe(false);
    expect((await store.loadSession(TENANT_A, "s1")).record?.history).toEqual([
      { content: "interloper", role: "user" },
    ]);
  });

  it("records run metadata scoped by tenant, user, and session", async () => {
    const store = new InMemorySessionStore();
    const meta = { finishedAt: 2, outcome: "success" as const, runId: "r1", startedAt: 1 };
    await store.recordRun(TENANT_A, "s1", meta);
    expect(await store.lastRun(TENANT_A, "s1")).toEqual(meta);
    expect(await store.lastRun(TENANT_B, "s1")).toBeNull();
    expect(await store.lastRun(TENANT_A, "other")).toBeNull();
  });

  it("round-trips complete session records and run metadata unchanged", async () => {
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

    await store.commitSession(TENANT_A, "s1", session, 0);
    await store.recordRun(TENANT_A, "s1", run);

    expect((await store.loadSession(TENANT_A, "s1")).record).toEqual(session);
    expect(await store.lastRun(TENANT_A, "s1")).toEqual(run);
  });

  it("bounds #sessions at MAX_SESSIONS via LRU eviction", async () => {
    const store = new InMemorySessionStore();
    const cap = 100;
    for (let i = 0; i < cap + 5; i += 1) {
      await store.commitSession({ tenantId: "t", userId: `u${i}` }, "s", record(`h${i}`), 0);
    }
    // The first 5 entries (u0..u4) should have been evicted.
    for (let i = 0; i < 5; i += 1) {
      expect((await store.loadSession({ tenantId: "t", userId: `u${i}` }, "s")).record).toBeNull();
    }
    // The most recent cap entries survive.
    expect(
      (await store.loadSession({ tenantId: "t", userId: `u${cap + 4}` }, "s")).record,
    ).not.toBeNull();
  });

  it("bounds #runs independently when recordRun is called without commitSession", async () => {
    // Regression for the cancel/error path: the runner skips commitSession on
    // cancel/error but still calls recordRun. Without an independent bound on
    // #runs, sustained failures would grow #runs without limit (contradicting
    // the documented LRU contract).
    const store = new InMemorySessionStore();
    const cap = 100;
    for (let i = 0; i < cap + 5; i += 1) {
      await store.recordRun({ tenantId: "t", userId: `u${i}` }, "s", {
        finishedAt: i,
        outcome: "error",
        runId: `r${i}`,
        startedAt: 0,
      });
    }
    // The first 5 entries should have been evicted from #runs.
    for (let i = 0; i < 5; i += 1) {
      expect(await store.lastRun({ tenantId: "t", userId: `u${i}` }, "s")).toBeNull();
    }
    // The most recent entry survives.
    expect(await store.lastRun({ tenantId: "t", userId: `u${cap + 4}` }, "s")).not.toBeNull();
  });
});
