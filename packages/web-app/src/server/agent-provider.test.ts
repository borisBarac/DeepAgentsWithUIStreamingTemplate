import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createFileSystemMemoryStore,
  createMemorySeedFiles,
  createUserMemoryBackend,
} from "@deep-agent-template/core/memory";

import { createAgentProvider } from "./agent-provider.ts";

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
  it("returns the advanced scaffolded agent by default", async () => {
    await withTempMemory({}, async (rootDir) => {
      const agent = await createAgentProvider();
      const systemPrompt = JSON.stringify(agent.options.systemPrompt);

      expect(agent).toBeTruthy();
      expect(typeof agent.invoke).toBe("function");
      expect(systemPrompt).toContain("Virtual filesystem contract");
      expect(systemPrompt).toContain("/home/user");
      expect(systemPrompt).toContain("/reports");
      expect(systemPrompt).toContain("/memory");
      expect(systemPrompt).not.toContain(rootDir);
    });
  });

  it("ignores WEB_APP_AGENT_PROVIDER_MODE and always returns the advanced agent", async () => {
    const agent = await withTempMemory({ WEB_APP_AGENT_PROVIDER_MODE: "simple" }, () =>
      createAgentProvider(),
    );
    expect(agent).toBeTruthy();
    expect(typeof agent.invoke).toBe("function");
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

  it("writes through the web app agent into its configured memory store", async () => {
    await withTempMemory({}, async (rootDir) => {
      const agent = await createAgentProvider();
      const writeFile = getWriteFileTool(agent);
      const virtualPath = "/memory/web-app-write-tool.md";
      const fullPath = path.join(rootDir, "single-user", "memory", "web-app-write-tool.md");

      await writeFile.invoke({
        file_path: virtualPath,
        content: "web app write succeeded",
      });

      const store = createFileSystemMemoryStore({ rootDir });
      const backend = createUserMemoryBackend({ store });
      await expect(backend.read(virtualPath)).resolves.toMatchObject({
        content: "web app write succeeded",
      });
      expect(path.isAbsolute(fullPath)).toBeTrue();
      await expect(readFile(fullPath, "utf8")).resolves.toBe("web app write succeeded");
    });
  });

  it("writes reports to the virtual reports root and denies host paths", async () => {
    await withTempMemory({}, async () => {
      const agent = await createAgentProvider();
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
});
