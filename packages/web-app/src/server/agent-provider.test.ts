import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createFileSystemMemoryStore,
  createUserMemoryBackend,
} from "@deep-agent-template/core/memory";

import {
  __getAgentCacheSizeForTest,
  __getGuestMemoryStoreForTest,
  __getMaxCachedGuestAgentsForTest,
  __resetGuestMemoryForTest,
  __setMaxCachedGuestAgentsForTest,
  createAgentForIdentity,
} from "./agent-provider.ts";

type WriteFileTool = {
  invoke(input: { content: string; file_path: string }): Promise<unknown>;
};

const BASE_ENV: Record<string, string> = {
  LLM_BASE_URL: "https://example.com/v1",
  LLM_API_KEY: "test-key",
  USE_FAKE_IMAGE_PROVIDER: "true",
};

async function withEnv<T>(
  overrides: Record<string, string | undefined>,
  fn: () => T | Promise<T>,
): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  const allKeys = new Set([...Object.keys(BASE_ENV), ...Object.keys(overrides)]);
  for (const key of allKeys) {
    previous[key] = process.env[key];
  }
  try {
    for (const [key, value] of Object.entries(BASE_ENV)) {
      process.env[key] = value;
    }
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function withTempMemory<T>(
  overrides: Record<string, string | undefined>,
  fn: (rootDir: string) => T | Promise<T>,
): Promise<T> {
  const rootDir = await mkdtemp(path.join(tmpdir(), "deep-agent-template-web-memory-"));
  try {
    return await withEnv(overrides, () => fn(rootDir));
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
}

function getWriteFileTool(
  agent: Awaited<ReturnType<typeof createAgentForIdentity>>,
): WriteFileTool {
  const filesystemMiddleware = agent.options.middleware?.find(
    (middleware) => middleware.name === "FilesystemMiddleware",
  );
  const writeFile = filesystemMiddleware?.tools?.find((tool) => tool.name === "write_file");
  if (!writeFile) {
    throw new Error("write_file was not registered on the web app agent.");
  }
  return writeFile as WriteFileTool;
}

describe("createAgentForIdentity", () => {
  // The guest memory store is a process-wide singleton. Reset it before each
  // test so agent cache + seeded memory never leak across cases.
  beforeEach(() => __resetGuestMemoryForTest());
  afterEach(() => __resetGuestMemoryForTest());

  function readGuestMemory(userId: string, memoryPath: string) {
    return createUserMemoryBackend({
      store: __getGuestMemoryStoreForTest(),
      userId,
    }).read(memoryPath);
  }

  it("wires the memory policy middleware on the guest agent", async () => {
    await withTempMemory({}, async () => {
      const agent = await createAgentForIdentity({ tenantId: "test-tenant", userId: "alice" });
      const middleware = agent.options.middleware ?? [];
      expect(middleware.find((m) => m.name === "memoryPolicy")).toBeTruthy();
    });
  });

  it("scopes memory writes by user inside the shared in-memory store", async () => {
    await withTempMemory({}, async () => {
      const agent = await createAgentForIdentity({ tenantId: "test-tenant", userId: "alice" });
      const writeFile = getWriteFileTool(agent);
      await writeFile.invoke({
        file_path: "/memory/identity-write.md",
        content: "alice memory",
      });

      await expect(readGuestMemory("alice", "/memory/identity-write.md")).resolves.toMatchObject({
        content: "alice memory",
      });
      await expect(
        readGuestMemory("single-user-fallback", "/memory/identity-write.md"),
      ).resolves.not.toMatchObject({ content: "alice memory" });
    });
  });

  it("isolates memory between users in the same shared store", async () => {
    await withTempMemory({}, async () => {
      const alice = await createAgentForIdentity({ tenantId: "test-tenant", userId: "alice" });
      await getWriteFileTool(alice).invoke({
        file_path: "/memory/notes.md",
        content: "alice notes",
      });
      const bob = await createAgentForIdentity({ tenantId: "test-tenant", userId: "bob" });
      await getWriteFileTool(bob).invoke({
        file_path: "/memory/notes.md",
        content: "bob notes",
      });

      await expect(readGuestMemory("alice", "/memory/notes.md")).resolves.toMatchObject({
        content: "alice notes",
      });
      await expect(readGuestMemory("bob", "/memory/notes.md")).resolves.toMatchObject({
        content: "bob notes",
      });
    });
  });

  it("memoizes the agent per user", async () => {
    await withTempMemory({}, async () => {
      const aliceFirst = await createAgentForIdentity({
        tenantId: "test-tenant",
        userId: "alice",
      });
      const aliceSecond = await createAgentForIdentity({
        tenantId: "test-tenant",
        userId: "alice",
      });
      const bob = await createAgentForIdentity({ tenantId: "test-tenant", userId: "bob" });
      expect(aliceFirst).toBe(aliceSecond);
      expect(bob).not.toBe(aliceFirst);
    });
  });

  it("does NOT write guest memory to the filesystem (ephemeral store)", async () => {
    await withTempMemory({}, async (rootDir) => {
      const agent = await createAgentForIdentity({ tenantId: "test-tenant", userId: "alice" });
      await getWriteFileTool(agent).invoke({
        file_path: "/memory/should-not-persist.md",
        content: "ephemeral",
      });

      // Memory IS available through the in-memory store...
      await expect(
        readGuestMemory("alice", "/memory/should-not-persist.md"),
      ).resolves.toMatchObject({ content: "ephemeral" });
      // ...but a filesystem store pointed at the same root sees nothing —
      // proving nothing was persisted to disk. (When the S3 follow-up
      // DeepAgentTemplate-58p3 lands, this assertion moves to the bucket store.)
      const fsStore = createFileSystemMemoryStore({ rootDir });
      await expect(
        createUserMemoryBackend({ store: fsStore, userId: "alice" }).read(
          "/memory/should-not-persist.md",
        ),
      ).resolves.not.toMatchObject({ content: "ephemeral" });
    });
  });

  it("drops cached state after __resetGuestMemoryForTest", async () => {
    await withTempMemory({}, async () => {
      const first = await createAgentForIdentity({
        tenantId: "test-tenant",
        userId: "alice",
      });
      await getWriteFileTool(first).invoke({
        file_path: "/memory/before-reset.md",
        content: "before",
      });

      __resetGuestMemoryForTest();

      // After reset, the previously written memory is gone (new store) and a
      // new agent is built.
      await expect(readGuestMemory("alice", "/memory/before-reset.md")).resolves.not.toMatchObject({
        content: "before",
      });
      const second = await createAgentForIdentity({
        tenantId: "test-tenant",
        userId: "alice",
      });
      expect(second).not.toBe(first);
    });
  });
});

describe("createAgentForIdentity — LRU eviction", () => {
  const defaultCap = __getMaxCachedGuestAgentsForTest();

  beforeEach(() => {
    __resetGuestMemoryForTest();
    __setMaxCachedGuestAgentsForTest(3);
  });
  afterEach(() => {
    __resetGuestMemoryForTest();
    __setMaxCachedGuestAgentsForTest(defaultCap);
  });

  it("defaults to a positive cap", () => {
    __setMaxCachedGuestAgentsForTest(defaultCap);
    expect(__getMaxCachedGuestAgentsForTest()).toBeGreaterThan(0);
  });

  it("keeps the cache size within the configured cap", async () => {
    await withTempMemory({}, async () => {
      for (let i = 0; i < 10; i += 1) {
        await createAgentForIdentity({ tenantId: "t", userId: `u${i}` });
      }
      expect(__getAgentCacheSizeForTest()).toBe(3);
    });
  });

  it("evicts the oldest entry when the cap is exceeded", async () => {
    await withTempMemory({}, async () => {
      const a = await createAgentForIdentity({ tenantId: "t", userId: "alice" });
      await createAgentForIdentity({ tenantId: "t", userId: "bob" });
      await createAgentForIdentity({ tenantId: "t", userId: "carol" });
      // Push alice out by exceeding the cap of 3.
      await createAgentForIdentity({ tenantId: "t", userId: "dave" });

      expect(__getAgentCacheSizeForTest()).toBe(3);
      // alice's cached agent is gone — a new build returns a different object.
      const aAgain = await createAgentForIdentity({ tenantId: "t", userId: "alice" });
      expect(aAgain).not.toBe(a);
    });
  });

  it("refreshes recency on hit so active guests survive eviction", async () => {
    await withTempMemory({}, async () => {
      const a = await createAgentForIdentity({ tenantId: "t", userId: "alice" });
      await createAgentForIdentity({ tenantId: "t", userId: "bob" });
      await createAgentForIdentity({ tenantId: "t", userId: "carol" });

      // Touch alice — she should now be the most-recent, not the oldest.
      const aTouched = await createAgentForIdentity({ tenantId: "t", userId: "alice" });
      expect(aTouched).toBe(a);

      // Adding dave evicts the oldest non-touched entry (bob), not alice.
      await createAgentForIdentity({ tenantId: "t", userId: "dave" });
      expect(__getAgentCacheSizeForTest()).toBe(3);

      const aStillCached = await createAgentForIdentity({ tenantId: "t", userId: "alice" });
      expect(aStillCached).toBe(a);

      // bob was evicted — a new build returns a different object.
      const bFirst = await createAgentForIdentity({ tenantId: "t", userId: "bob" });
      const bNext = await createAgentForIdentity({ tenantId: "t", userId: "bob" });
      expect(bFirst).toBe(bNext); // now cached again
    });
  });
});
