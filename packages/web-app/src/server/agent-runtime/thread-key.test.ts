import { describe, expect, it } from "bun:test";

import { createInternalThreadKey } from "./thread-key.ts";

describe("createInternalThreadKey", () => {
  it("is deterministic for the same tenant, user, and session", () => {
    expect(createInternalThreadKey("t1", "u1", "s1")).toBe(
      createInternalThreadKey("t1", "u1", "s1"),
    );
  });

  it("never collides across tenants sharing a user and session", () => {
    const a = createInternalThreadKey("tenant-a", "u1", "s1");
    const b = createInternalThreadKey("tenant-b", "u1", "s1");
    expect(a).not.toBe(b);
  });

  it("never collides across users sharing a tenant and session", () => {
    const a = createInternalThreadKey("t1", "user-a", "s1");
    const b = createInternalThreadKey("t1", "user-b", "s1");
    expect(a).not.toBe(b);
  });

  it("never collides when only the session differs", () => {
    const a = createInternalThreadKey("t1", "u1", "session-a");
    const b = createInternalThreadKey("t1", "u1", "session-b");
    expect(a).not.toBe(b);
  });

  it("produces filesystem-safe, stable prefix segments", () => {
    const key = createInternalThreadKey("t1", "u1", "s1");
    expect(key.startsWith("rt_")).toBe(true);
    expect(key).toMatch(/^rt_[0-9a-f]{32}$/);
    expect(key).not.toContain("/");
  });
});
