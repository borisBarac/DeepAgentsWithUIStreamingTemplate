import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CompositeBackend, StateBackend, StoreBackend } from "deepagents";

import { createDefaultCompositeBackend, createDefaultPermissions } from "../scaffold/index.ts";
import { createRuntimeScaffold } from "../scaffold/runtime.ts";
import {
  BucketMemoryStore,
  createBucketMemoryStore,
  createFileSystemMemoryStore,
  createInMemoryMemoryStore,
  createMemoryRepository,
  createMemorySeedFiles,
  createUserMemoryBackend,
  createUserMemoryNamespace,
  DEFAULT_MEMORY_FILE_PATHS,
  DEFAULT_MEMORY_ROOT,
  DEFAULT_PROJECT_FACTS_PATH,
  DEFAULT_USER_PREFERENCES_PATH,
  FileSystemMemoryStore,
  normalizeVirtualPath,
  reviewMemoryContent,
} from "./index.ts";

const testImageGenerationService = {
  async generate() {
    return { success: true as const, url: "https://example.com/generated.png" };
  },
  async edit() {
    return { success: true as const, url: "https://example.com/edited.png" };
  },
};

describe("memory default paths", () => {
  it("loads durable memory files by default", () => {
    expect(DEFAULT_MEMORY_FILE_PATHS).toEqual([
      "/memory/project-facts.md",
      "/memory/user-preferences.md",
    ]);
    expect(DEFAULT_PROJECT_FACTS_PATH).toBe("/memory/project-facts.md");
    expect(DEFAULT_USER_PREFERENCES_PATH).toBe("/memory/user-preferences.md");
  });

  it("is consumed by the default runtime scaffold blueprint", () => {
    const scaffold = createRuntimeScaffold({ imageGenerationService: testImageGenerationService });
    expect(scaffold.memoryFilePaths).toEqual([
      "/memory/project-facts.md",
      "/memory/user-preferences.md",
    ]);
    expect(scaffold.memory).toEqual(["/memory/project-facts.md", "/memory/user-preferences.md"]);
  });
});

describe("user memory namespace", () => {
  it("returns a user-scoped namespace when userId is supplied", () => {
    expect(createUserMemoryNamespace("u1")).toEqual(["users", "u1", "memory"]);
  });

  it("encodes user IDs that are unsafe for BaseStore namespace labels", () => {
    const namespace = createUserMemoryNamespace("alice@example.com");

    expect(namespace).toEqual(["users", "encoded_YWxpY2VAZXhhbXBsZS5jb20", "memory"]);
    expect(namespace[1]).not.toContain(".");
  });

  it("rejects unsafe user IDs", () => {
    expect(() => createUserMemoryNamespace("../u1")).toThrow("userId may only contain");
    expect(() => createUserMemoryNamespace("u1/u2")).toThrow("userId may only contain");
    expect(() => createUserMemoryNamespace("u1 u2")).toThrow("userId may only contain");
  });
});

describe("memory virtual path validation", () => {
  it("accepts absolute virtual paths", () => {
    expect(normalizeVirtualPath("/memory/project-facts.md")).toBe("/memory/project-facts.md");
  });

  it("rejects relative, traversal, root-only, backslash, and empty segment paths", () => {
    expect(() => normalizeVirtualPath("memory/project-facts.md")).toThrow("absolute");
    expect(() => normalizeVirtualPath("/memory/../facts.md")).toThrow("traversal");
    expect(() => normalizeVirtualPath("/memory/./facts.md")).toThrow("traversal");
    expect(() => normalizeVirtualPath("/")).toThrow("cannot be '/'");
    expect(() => normalizeVirtualPath("/memory\\facts.md")).toThrow("backslashes");
    expect(() => normalizeVirtualPath("/memory//facts.md")).toThrow("empty segments");
  });
});

describe("memory repository", () => {
  it("writes, reads, updates, upserts, searches, lists, and deletes files", async () => {
    const store = createInMemoryMemoryStore();
    const repo = createMemoryRepository({ store, userId: "u1" });

    expect(await repo.read("/memory/project-facts.md")).toBeNull();

    await repo.write("/memory/project-facts.md", "Bun runs the tests.");
    expect(await repo.read("/memory/project-facts.md")).toBe("Bun runs the tests.");
    await expect(repo.write("/memory/project-facts.md", "duplicate")).rejects.toThrow(
      "already exists",
    );

    await repo.update("/memory/project-facts.md", "TypeScript uses strict mode.");
    expect(await repo.read("/memory/project-facts.md")).toBe("TypeScript uses strict mode.");
    await expect(repo.update("/memory/missing.md", "missing")).rejects.toThrow("does not exist");

    await repo.upsert("/memory/nested/user-preferences.md", "Prefers short summaries.");
    await repo.upsert("/memory/new.md", "Substring matching works.");

    expect((await repo.search("/memory", "typescript")).map((item) => item.path)).toEqual([
      "/memory/project-facts.md",
    ]);
    expect(await repo.list("/memory")).toEqual([
      { path: "/memory/nested/", isDirectory: true },
      {
        path: "/memory/new.md",
        isDirectory: false,
        size: "Substring matching works.".length,
        modifiedAt: expect.any(String),
      },
      {
        path: "/memory/project-facts.md",
        isDirectory: false,
        size: "TypeScript uses strict mode.".length,
        modifiedAt: expect.any(String),
      },
    ]);

    await repo.delete("/memory/project-facts.md");
    await repo.delete("/memory/project-facts.md");
    expect(await repo.read("/memory/project-facts.md")).toBeNull();
  });

  it("isolates users on the same store", async () => {
    const store = createInMemoryMemoryStore();
    const alice = createMemoryRepository({ store, userId: "alice" });
    const bob = createMemoryRepository({ store, userId: "bob" });

    await alice.write("/memory/project-facts.md", "Alice facts");
    await bob.write("/memory/project-facts.md", "Bob facts");

    expect(await alice.read("/memory/project-facts.md")).toBe("Alice facts");
    expect(await bob.read("/memory/project-facts.md")).toBe("Bob facts");
  });
});

describe("filesystem memory store", () => {
  it("writes markdown files and persists across store instances", async () => {
    const rootDir = await makeTempMemoryDir();
    try {
      const firstStore = createFileSystemMemoryStore({ rootDir });
      const firstRepo = createMemoryRepository({ store: firstStore, userId: "u1" });

      await firstRepo.write("/memory/project-facts.md", "Persistent markdown");

      const markdown = await readFile(
        path.join(rootDir, "users", "u1", "memory", "memory", "project-facts.md"),
        "utf8",
      );
      expect(markdown).toBe("Persistent markdown");

      const secondStore = createFileSystemMemoryStore({ rootDir });
      const secondRepo = createMemoryRepository({ store: secondStore, userId: "u1" });
      expect(await secondRepo.read("/memory/project-facts.md")).toBe("Persistent markdown");
    } finally {
      await rm(rootDir, { force: true, recursive: true });
    }
  });

  it("supports BaseStore get, put, delete, search, and listNamespaces", async () => {
    const rootDir = await makeTempMemoryDir();
    try {
      const store = new FileSystemMemoryStore({ rootDir });
      const namespace = ["users", "u1", "memory"];

      await store.put(namespace, "/memory/project-facts.md", {
        content: "Needle in markdown",
        created_at: "2026-01-01T00:00:00.000Z",
        modified_at: "2026-01-01T00:00:00.000Z",
        mimeType: "text/markdown",
        priority: 3,
      });

      const item = await store.get(namespace, "/memory/project-facts.md");
      expect(item?.value.content).toBe("Needle in markdown");

      expect(
        (
          await store.search(["users", "u1"], {
            query: "needle",
            filter: { priority: { $gte: 3 } },
          })
        ).map((result) => result.key),
      ).toEqual(["/memory/project-facts.md"]);

      expect(await store.listNamespaces({ prefix: ["users"], maxDepth: 2 })).toEqual([
        ["users", "u1"],
      ]);
      expect(await store.listNamespaces({ suffix: ["memory"], maxDepth: 2 })).toEqual([
        ["users", "u1"],
      ]);

      await store.delete(namespace, "/memory/project-facts.md");
      expect(await store.get(namespace, "/memory/project-facts.md")).toBeNull();
    } finally {
      await rm(rootDir, { force: true, recursive: true });
    }
  });

  it("rejects non-string content", async () => {
    const rootDir = await makeTempMemoryDir();
    try {
      const store = new FileSystemMemoryStore({ rootDir });
      await expect(
        store.put(["users", "u1", "memory"], "/memory/project-facts.md", {
          content: new Uint8Array([1, 2, 3]),
        }),
      ).rejects.toThrow("only supports string content");
    } finally {
      await rm(rootDir, { force: true, recursive: true });
    }
  });

  it("rejects aliasing path and namespace components", async () => {
    const rootDir = await makeTempMemoryDir();
    try {
      const store = new FileSystemMemoryStore({ rootDir });

      await expect(
        store.put(["users", "u1", "memory"], "/memory/./project-facts.md", {
          content: "Aliased content",
        }),
      ).rejects.toThrow("traversal");
      await expect(
        store.put(["users", "..", "memory"], "/memory/project-facts.md", {
          content: "Aliased namespace",
        }),
      ).rejects.toThrow("Unsafe namespace component");
    } finally {
      await rm(rootDir, { force: true, recursive: true });
    }
  });
});

describe("bucket memory store", () => {
  it("is a placeholder that throws", async () => {
    const store = createBucketMemoryStore();
    expect(store).toBeInstanceOf(BucketMemoryStore);
    await expect(store.get(["users", "u1", "memory"], "/memory/project-facts.md")).rejects.toThrow(
      "BucketMemoryStore is not implemented yet.",
    );
  });
});

describe("memory backend routing", () => {
  it("routes /memory to a dedicated store-backed route while other paths fall through to state", () => {
    const memoryBackend = new StoreBackend({ namespace: createUserMemoryNamespace("test-user") });
    const defaultBackend = new StateBackend();

    const backend = createDefaultCompositeBackend({ defaultBackend, memoryBackend });

    expect(backend).toBeInstanceOf(CompositeBackend);
    expect(backend.routePrefixes).toEqual([`${DEFAULT_MEMORY_ROOT}/`]);
    const routes = (backend as unknown as { routes: Record<string, unknown> }).routes;
    expect(routes[`${DEFAULT_MEMORY_ROOT}/`]).toBeDefined();
    expect(routes[`${DEFAULT_MEMORY_ROOT}/`]).not.toBe(defaultBackend);
  });

  it("creates a user-scoped StoreBackend", () => {
    const backend = createUserMemoryBackend({ store: createInMemoryMemoryStore(), userId: "u1" });

    expect(backend).toBeInstanceOf(StoreBackend);
  });

  it("supports dotted user IDs with StoreBackend writes", async () => {
    const backend = createUserMemoryBackend({
      store: createInMemoryMemoryStore(),
      userId: "alice@example.com",
    });

    const result = await backend.write("/memory/project-facts.md", "Backend memory");

    expect(result.path).toBe("/memory/project-facts.md");
    expect(result.error).toBeUndefined();
  });
});

describe("memory permissions", () => {
  it("includes the v1 writable memory files in the default writable roots", () => {
    const permissions = createDefaultPermissions();
    const writableEntry = permissions.find(
      (entry) => entry.operations.includes("write") && entry.mode !== "deny",
    );
    expect(writableEntry?.paths).toContain("/memory");
    expect(writableEntry?.paths).toContain("/memory/**");
  });

  it("keeps the default permission safety when custom memory paths are supplied", () => {
    const scaffold = createRuntimeScaffold({
      imageGenerationService: testImageGenerationService,
      memoryFilePaths: ["/memory/custom.md"],
    });

    expect(scaffold.memoryFilePaths).toEqual(["/memory/custom.md"]);
    const denyWrite = scaffold.permissions.find(
      (entry) => entry.mode === "deny" && entry.operations.includes("write"),
    );
    expect(denyWrite).toBeDefined();
    const memoryWritable = scaffold.permissions.some(
      (entry) => entry.operations.includes("write") && entry.paths.includes("/memory/**"),
    );
    expect(memoryWritable).toBe(true);
  });
});

describe("memory seed helpers", () => {
  it("produces deterministic seed files for the default memory paths", () => {
    const seeds = createMemorySeedFiles();
    expect(seeds.map((seed) => seed.path)).toEqual([
      "/memory/project-facts.md",
      "/memory/user-preferences.md",
    ]);
    expect(createMemorySeedFiles()).toEqual(seeds);
    expect(seeds[0]?.content).toContain("Project Facts");
    expect(seeds[1]?.content).toContain("User Preferences");
  });
});

describe("memory content policy", () => {
  it("allows explicit preferences and stable project facts", () => {
    expect(reviewMemoryContent("Build commands use Bun. Tests run via bun test.").allowed).toBe(
      true,
    );
    expect(reviewMemoryContent("The user asked to always answer in British English.").allowed).toBe(
      true,
    );
  });

  it("rejects credentials and secrets", () => {
    expect(reviewMemoryContent("OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz").allowed).toBe(false);
    expect(reviewMemoryContent("password=hunter2").allowed).toBe(false);
    expect(reviewMemoryContent("client_secret=supersecret").allowed).toBe(false);
  });

  it("rejects inferred preferences", () => {
    expect(reviewMemoryContent("The user probably prefers concise answers.").allowed).toBe(false);
    expect(reviewMemoryContent("The user seems to like short replies.").allowed).toBe(false);
  });

  it("rejects transient task details", () => {
    expect(reviewMemoryContent("Remember this for this task only.").allowed).toBe(false);
    expect(reviewMemoryContent("Disable linting temporarily.").allowed).toBe(false);
  });

  it("does not false-positive on the seed wording", () => {
    for (const seed of createMemorySeedFiles()) {
      expect(reviewMemoryContent(seed.content).allowed).toBe(true);
    }
  });
});

async function makeTempMemoryDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "deep-agent-template-memory-"));
}
