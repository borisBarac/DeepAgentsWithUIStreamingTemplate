import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { createMemorySeedFiles, createUserMemoryBackend } from "@deep-agent-template/core/memory";

import {
  __resetAgentCacheForTest,
  __setLinkloomConnectionForTest,
  __setMemoryStoreForTest,
  __setSandboxConnectionForTest,
  createAgentProvider,
} from "./agent-provider.ts";
import { FakeRedis } from "./redis/fake-redis.ts";
import { RedisMemoryStore } from "./redis/redis-memory-store.ts";

const TEST_IDENTITY = { tenantId: "guest", userId: "test-user" } as const;
const TEST_MEMORY_USER_ID = "guest:test-user";

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

function makeTestStore(): { store: RedisMemoryStore; fake: FakeRedis } {
  const fake = new FakeRedis();
  const store = new RedisMemoryStore({ client: fake.asRedis(), keyPrefix: "dat:" });
  return { store, fake };
}

function getWriteFileTool(agent: Awaited<ReturnType<typeof createAgentProvider>>): WriteFileTool {
  const filesystemMiddleware = agent.options.middleware?.find(
    (middleware) => middleware.name === "FilesystemMiddleware",
  );
  const writeFile = filesystemMiddleware?.tools?.find((tool) => tool.name === "write_file");
  if (!writeFile) {
    throw new Error("write_file was not registered on the web app agent.");
  }
  return writeFile as WriteFileTool;
}

describe("createAgentProvider", () => {
  beforeEach(() => {
    __setLinkloomConnectionForTest(null);
    __setSandboxConnectionForTest(null);
    __resetAgentCacheForTest();
  });

  afterEach(() => {
    __setMemoryStoreForTest(undefined);
    __resetAgentCacheForTest();
  });

  it("returns the advanced scaffolded agent by default", async () => {
    const { store } = makeTestStore();
    __setMemoryStoreForTest(store);
    await withEnv({}, async () => {
      const agent = await createAgentProvider(TEST_IDENTITY);
      const systemPrompt = JSON.stringify(agent.options.systemPrompt);

      expect(agent).toBeTruthy();
      expect(typeof agent.invoke).toBe("function");
      expect(systemPrompt).toContain("Virtual filesystem contract");
      expect(systemPrompt).toContain("/home/user");
      expect(systemPrompt).toContain("/reports");
      expect(systemPrompt).toContain("/memory");
    });
  });

  it("ignores WEB_APP_AGENT_PROVIDER_MODE and always returns the advanced agent", async () => {
    const { store } = makeTestStore();
    __setMemoryStoreForTest(store);
    const agent = await withEnv({ WEB_APP_AGENT_PROVIDER_MODE: "simple" }, () =>
      createAgentProvider(TEST_IDENTITY),
    );
    expect(agent).toBeTruthy();
    expect(typeof agent.invoke).toBe("function");
  });

  it("seeds missing memory files and preserves backend edits across providers", async () => {
    const { store } = makeTestStore();
    __setMemoryStoreForTest(store);
    await withEnv({}, async () => {
      await createAgentProvider(TEST_IDENTITY);

      const backend = createUserMemoryBackend({ store, userId: TEST_MEMORY_USER_ID });
      const seeds = createMemorySeedFiles();

      for (const seed of seeds) {
        await expect(backend.read(seed.path)).resolves.toMatchObject({
          content: seed.content,
        });
      }

      for (const seed of seeds) {
        const edit = await backend.edit(seed.path, seed.content, `Edited ${seed.path}`);
        expect(edit.error).toBeUndefined();
      }

      __resetAgentCacheForTest();
      await createAgentProvider(TEST_IDENTITY);

      for (const seed of seeds) {
        await expect(backend.read(seed.path)).resolves.toMatchObject({
          content: `Edited ${seed.path}`,
        });
      }
    });
  });

  it("concurrently seeds only missing memory files", async () => {
    const { store } = makeTestStore();
    __setMemoryStoreForTest(store);
    await withEnv({}, async () => {
      const backend = createUserMemoryBackend({ store, userId: TEST_MEMORY_USER_ID });
      const [projectFacts] = createMemorySeedFiles();
      if (!projectFacts) throw new Error("expected project facts seed");
      await backend.write(projectFacts.path, "Existing project facts");

      await Promise.all([createAgentProvider(TEST_IDENTITY), createAgentProvider(TEST_IDENTITY)]);

      await expect(backend.read(projectFacts.path)).resolves.toMatchObject({
        content: "Existing project facts",
      });
      const remainingSeeds = createMemorySeedFiles().filter(
        (seed) => seed.path !== projectFacts.path,
      );
      for (const seed of remainingSeeds) {
        await expect(backend.read(seed.path)).resolves.toMatchObject({ content: seed.content });
      }
    });
  });

  it("writes through the web app agent into its Redis memory store", async () => {
    const { store } = makeTestStore();
    __setMemoryStoreForTest(store);
    await withEnv({}, async () => {
      const agent = await createAgentProvider(TEST_IDENTITY);
      const writeFile = getWriteFileTool(agent);
      const virtualPath = "/memory/web-app-write-tool.md";

      await writeFile.invoke({
        file_path: virtualPath,
        content: "web app write succeeded",
      });

      const backend = createUserMemoryBackend({ store, userId: TEST_MEMORY_USER_ID });
      await expect(backend.read(virtualPath)).resolves.toMatchObject({
        content: "web app write succeeded",
      });
    });
  });

  it("writes reports to the virtual reports root and denies host paths", async () => {
    const { store } = makeTestStore();
    __setMemoryStoreForTest(store);
    await withEnv({}, async () => {
      const agent = await createAgentProvider(TEST_IDENTITY);
      const writeFile = getWriteFileTool(agent);

      await expect(
        writeFile.invoke({
          file_path: "/reports/kanban_board_research.md",
          content: "kanban research",
        }),
      ).resolves.toMatchObject({
        content: "Successfully wrote to '/reports/kanban_board_research.md'",
      });
      await expect(
        writeFile.invoke({
          file_path: "/home/user/kanban_board_research.md",
          content: "kanban research",
        }),
      ).rejects.toThrow(
        "Error: permission denied for write on /home/user/kanban_board_research.md",
      );
    });
  });

  it("isolates guest memory writes by identity", async () => {
    const { store } = makeTestStore();
    __setMemoryStoreForTest(store);
    const alice = { tenantId: "guest", userId: "alice" } as const;
    const bob = { tenantId: "guest", userId: "bob" } as const;
    await withEnv({}, async () => {
      const aliceAgent = await createAgentProvider(alice);
      const bobAgent = await createAgentProvider(bob);
      await getWriteFileTool(aliceAgent).invoke({
        file_path: "/memory/private.md",
        content: "alice-only",
      });

      const aliceBackend = createUserMemoryBackend({ store, userId: "guest:alice" });
      const bobBackend = createUserMemoryBackend({ store, userId: "guest:bob" });
      await expect(aliceBackend.read("/memory/private.md")).resolves.toMatchObject({
        content: "alice-only",
      });
      await expect(bobBackend.read("/memory/private.md")).resolves.toMatchObject({
        error: "File '/memory/private.md' not found",
      });
      expect(bobAgent).toBeTruthy();
    });
  });
});
