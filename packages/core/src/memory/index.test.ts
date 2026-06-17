import { describe, expect, it } from "bun:test";
import { CompositeBackend, StateBackend, StoreBackend } from "deepagents";

import { createDefaultCompositeBackend, createDefaultPermissions } from "../scaffold/index.ts";
import { createRuntimeScaffold } from "../scaffold/runtime.ts";
import {
  createDefaultMemorySeedFiles,
  createSingleUserMemoryNamespace,
  createSingleUserMemoryPolicy,
  DEFAULT_MEMORY_FILE_PATHS,
  DEFAULT_MEMORY_ROOT,
  DEFAULT_PROJECT_FACTS_PATH,
  DEFAULT_USER_PREFERENCES_PATH,
  isMemoryWriteAutoApproved,
  resolveMemoryInterrupts,
  resolveMemoryNamespace,
  reviewMemoryContent,
} from "./index.ts";

describe("memory default paths", () => {
  it("loads project-facts.md and user-preferences.md by default", () => {
    expect(DEFAULT_MEMORY_FILE_PATHS).toEqual([
      "/memory/project-facts.md",
      "/memory/user-preferences.md",
    ]);
    expect(DEFAULT_PROJECT_FACTS_PATH).toBe("/memory/project-facts.md");
    expect(DEFAULT_USER_PREFERENCES_PATH).toBe("/memory/user-preferences.md");
  });

  it("is consumed by the default runtime scaffold blueprint", () => {
    const scaffold = createRuntimeScaffold();
    expect(scaffold.memoryFilePaths).toEqual([
      "/memory/project-facts.md",
      "/memory/user-preferences.md",
    ]);
    expect(scaffold.memory).toEqual(["/memory/project-facts.md", "/memory/user-preferences.md"]);
  });
});

describe("single-user memory namespace", () => {
  it("returns a stable single-user namespace", () => {
    const namespace = createSingleUserMemoryNamespace();
    expect(namespace).toEqual(["single-user"]);
    expect(createSingleUserMemoryNamespace()).toEqual(namespace);
    expect(createSingleUserMemoryNamespace()).not.toBe(namespace);
  });

  it("resolves an explicit namespace override", () => {
    expect(resolveMemoryNamespace()).toEqual(["single-user"]);
    expect(resolveMemoryNamespace(["custom-user"])).toEqual(["custom-user"]);
  });
});

describe("memory backend routing", () => {
  it("routes /memory to a dedicated store-backed route while other paths fall through to state", () => {
    const memoryBackend = new StoreBackend({ namespace: createSingleUserMemoryNamespace() });
    const defaultBackend = new StateBackend();

    const backend = createDefaultCompositeBackend({ defaultBackend, memoryBackend });

    expect(backend).toBeInstanceOf(CompositeBackend);
    expect(backend.routePrefixes).toEqual([DEFAULT_MEMORY_ROOT]);
    const routes = (backend as unknown as { routes: Record<string, unknown> }).routes;
    expect(routes[DEFAULT_MEMORY_ROOT]).toBeDefined();
    expect(routes[DEFAULT_MEMORY_ROOT]).not.toBe(defaultBackend);
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

describe("single-user memory approval policy", () => {
  it("auto-approves the v1 writable memory files", () => {
    const policy = createSingleUserMemoryPolicy();
    expect(policy.approvalMode).toBe("auto");
    expect(policy.autoApprovedPaths).toContain("/memory/project-facts.md");
    expect(policy.autoApprovedPaths).toContain("/memory/user-preferences.md");
    expect(isMemoryWriteAutoApproved(policy, "/memory/user-preferences.md")).toBe(true);
    expect(isMemoryWriteAutoApproved(policy, "/memory/project-facts.md")).toBe(true);
  });

  it("does not auto-approve writes outside the memory files", () => {
    const policy = createSingleUserMemoryPolicy();
    expect(isMemoryWriteAutoApproved(policy, "/scratch/notes.md")).toBe(false);
    expect(isMemoryWriteAutoApproved(policy, "/reports/final.md")).toBe(false);
  });

  it("keeps sensitive tool interrupts enabled when applying memory auto-approval", () => {
    const policy = createSingleUserMemoryPolicy();
    expect(policy.protectedInterrupts).toEqual(["write_file", "edit_file", "execute"]);

    const interrupts = resolveMemoryInterrupts({
      write_file: true,
      edit_file: true,
      execute: true,
    });
    expect(interrupts).toEqual({ write_file: true, edit_file: true, execute: true });
  });
});

describe("memory seed helpers", () => {
  it("produces deterministic seed files for the default memory paths", () => {
    const seeds = createDefaultMemorySeedFiles();
    expect(seeds.map((seed) => seed.path)).toEqual([
      "/memory/project-facts.md",
      "/memory/user-preferences.md",
    ]);
    expect(createDefaultMemorySeedFiles()).toEqual(seeds);
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
    for (const seed of createDefaultMemorySeedFiles()) {
      expect(reviewMemoryContent(seed.content).allowed).toBe(true);
    }
  });
});
