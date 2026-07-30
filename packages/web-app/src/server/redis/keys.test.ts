import { describe, expect, it } from "bun:test";

import {
  createRedisKeys,
  DEFAULT_LOCK_LEASE_SECONDS,
  DEFAULT_TTL_SECONDS,
  hashNamespace,
  identityMaterial,
  resolveTtlConfig,
} from "./keys.ts";

const ID = { tenantId: "tenant-a", userId: "user-1" };

describe("createRedisKeys", () => {
  it("namespaces every key under the configured prefix", () => {
    const keys = createRedisKeys("dat:");
    expect(keys.session(ID.tenantId, ID.userId, "s1")).toMatch(/^dat:session:state:[0-9a-f]+$/);
    expect(keys.sessionVersion(ID.tenantId, ID.userId, "s1")).toMatch(
      /^dat:session:ver:[0-9a-f]+$/,
    );
    expect(keys.runMetadata(ID.tenantId, ID.userId, "s1")).toMatch(
      /^dat:session:runmeta:[0-9a-f]+$/,
    );
    expect(keys.runState("run-xyz")).toBe("dat:run:state:run-xyz");
    expect(keys.runStream("run-xyz")).toBe("dat:stream:run-xyz");
    expect(keys.sessionLock(ID.tenantId, ID.userId, "s1")).toMatch(/^dat:lock:[0-9a-f]+$/);
    expect(keys.cancellation("run-xyz")).toBe("dat:cancel:run-xyz");
    expect(keys.memoryNamespaceIndex("ns-hash")).toBe("dat:memory:idx:ns-hash");
    expect(keys.memoryItem("ns-hash", "memory-key")).toMatch(/^dat:memory:item:ns-hash:[0-9a-f]+$/);
    expect(keys.memoryNamespaceRegistry()).toBe("dat:memory:namespaces");
  });

  it("isolates distinct identities by hashing them into different keys", () => {
    const keys = createRedisKeys("dat:");
    const a = keys.session("t1", "u1", "shared");
    const b = keys.session("t2", "u2", "shared");
    const c = keys.session("t1", "u1", "different");
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it("produces stable keys for the same identity + session", () => {
    const keys = createRedisKeys("dat:");
    expect(keys.session(ID.tenantId, ID.userId, "s1")).toBe(
      keys.session(ID.tenantId, ID.userId, "s1"),
    );
  });

  it("uses different prefixes without collision", () => {
    const alpha = createRedisKeys("alpha:");
    const beta = createRedisKeys("beta:");
    expect(alpha.runState("r")).not.toBe(beta.runState("r"));
    expect(alpha.runState("r")).toBe("alpha:run:state:r");
  });
});

describe("identityMaterial", () => {
  it("joins identity components with a NUL byte so prefixes cannot collide", () => {
    expect(identityMaterial({ tenantId: "ab", userId: "c" }, "session")).toBe(
      `ab\u0000c\u0000session`,
    );
    expect(identityMaterial({ tenantId: "a", userId: "bc" }, "x")).not.toBe(
      identityMaterial({ tenantId: "ab", userId: "c" }, "x"),
    );
  });
});

describe("hashNamespace", () => {
  it("hashes a namespace tuple deterministically", () => {
    expect(hashNamespace(["t", "u", "mem"])).toBe(hashNamespace(["t", "u", "mem"]));
    expect(hashNamespace(["t", "u", "mem"])).not.toBe(hashNamespace(["t", "u", "other"]));
  });
});

describe("TTL config", () => {
  it("returns documented defaults", () => {
    expect(DEFAULT_TTL_SECONDS.session).toBe(60 * 60 * 12);
    expect(DEFAULT_TTL_SECONDS.runMetadata).toBeGreaterThan(0);
    expect(DEFAULT_TTL_SECONDS.runState).toBeLessThan(DEFAULT_TTL_SECONDS.session);
    expect(DEFAULT_TTL_SECONDS.runStream).toBeLessThan(DEFAULT_TTL_SECONDS.session);
    expect(DEFAULT_LOCK_LEASE_SECONDS).toBeGreaterThan(0);
  });

  it("merges overrides on top of defaults", () => {
    const resolved = resolveTtlConfig({ runState: 10, cancellation: 99 });
    expect(resolved.runState).toBe(10);
    expect(resolved.cancellation).toBe(99);
    expect(resolved.session).toBe(DEFAULT_TTL_SECONDS.session);
  });
});
