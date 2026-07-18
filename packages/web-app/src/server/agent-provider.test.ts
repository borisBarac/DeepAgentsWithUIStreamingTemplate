import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createFileSystemMemoryStore,
  createMemorySeedFiles,
  createUserMemoryBackend,
} from "@deep-agent-template/core/memory";

import { createAgentProvider } from "./agent-provider.ts";

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
  const cwd = process.cwd();
  const webAppDirectory =
    path.basename(cwd) === "web-app" && path.basename(path.dirname(cwd)) === "packages"
      ? cwd
      : path.resolve(cwd, "packages/web-app");
  const relativeRoot = path.relative(webAppDirectory, rootDir);

  try {
    return await withEnv({ ...overrides, WEB_APP_MEMORY_DIR: relativeRoot }, () => fn(rootDir));
  } finally {
    await rm(rootDir, { force: true, recursive: true });
  }
}

describe("createAgentProvider", () => {
  it("returns the advanced scaffolded agent by default", async () => {
    const agent = await withTempMemory({}, () => createAgentProvider());
    expect(agent).toBeTruthy();
    expect(typeof agent.invoke).toBe("function");
  });

  it("ignores WEB_APP_AGENT_PROVIDER_MODE and always returns the advanced agent", async () => {
    const agent = await withTempMemory({ WEB_APP_AGENT_PROVIDER_MODE: "simple" }, () =>
      createAgentProvider(),
    );
    expect(agent).toBeTruthy();
    expect(typeof agent.invoke).toBe("function");
  });

  it("passes WEB_APP_CLARIFICATION_MAX_ROUNDS to the scaffold without error", async () => {
    const agent = await withTempMemory({ WEB_APP_CLARIFICATION_MAX_ROUNDS: "1" }, () =>
      createAgentProvider(),
    );
    expect(agent).toBeTruthy();
    expect(typeof agent.invoke).toBe("function");
  });

  it("throws clearly when WEB_APP_CLARIFICATION_MAX_ROUNDS is zero", async () => {
    await expect(
      withTempMemory({ WEB_APP_CLARIFICATION_MAX_ROUNDS: "0" }, () => createAgentProvider()),
    ).rejects.toThrow("WEB_APP_CLARIFICATION_MAX_ROUNDS must be a positive integer");
  });

  it("throws clearly when WEB_APP_CLARIFICATION_MAX_ROUNDS is non-numeric", async () => {
    await expect(
      withTempMemory({ WEB_APP_CLARIFICATION_MAX_ROUNDS: "abc" }, () => createAgentProvider()),
    ).rejects.toThrow("WEB_APP_CLARIFICATION_MAX_ROUNDS must be a positive integer");
  });

  it("throws clearly when WEB_APP_CLARIFICATION_MAX_ROUNDS is a decimal", async () => {
    await expect(
      withTempMemory({ WEB_APP_CLARIFICATION_MAX_ROUNDS: "1.5" }, () => createAgentProvider()),
    ).rejects.toThrow("WEB_APP_CLARIFICATION_MAX_ROUNDS must be a positive integer");
  });

  it("seeds missing memory files and preserves backend edits across providers", async () => {
    await withTempMemory({}, async (rootDir) => {
      await createAgentProvider();

      const store = createFileSystemMemoryStore({ rootDir });
      const backend = createUserMemoryBackend({ store });
      const seeds = createMemorySeedFiles();

      for (const seed of seeds) {
        await expect(backend.read(seed.path)).resolves.toMatchObject({ content: seed.content });
      }

      const editedContents = new Map(
        seeds.map((seed, index) => [seed.path, `Edited memory ${index + 1}`]),
      );
      for (const seed of seeds) {
        const edit = await backend.edit(
          seed.path,
          seed.content,
          editedContents.get(seed.path) ?? "",
        );
        expect(edit.error).toBeUndefined();
      }

      await createAgentProvider();

      for (const [memoryPath, content] of editedContents) {
        await expect(backend.read(memoryPath)).resolves.toMatchObject({ content });
      }
    });
  });
});
