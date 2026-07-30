import path from "node:path";

import { createScaffoldedAgent, type DeepAgent } from "@deep-agent-template/core/agent";
import { catalogPrompt } from "@deep-agent-template/core/generative-ui";
import {
  createFileSystemMemoryStore,
  createMemoryRepository,
  createMemorySeedFiles,
} from "@deep-agent-template/core/memory";
import { createModelRuntimeFromEnv } from "@deep-agent-template/core/models";
import { createImageGenerationServiceFromEnv } from "@deep-agent-template/image-gen";

import type { ExecutionIdentity } from "./agent-runtime/types.ts";

function resolveWebAppDirectory(): string {
  const cwd = process.cwd();
  return path.basename(cwd) === "web-app" && path.basename(path.dirname(cwd)) === "packages"
    ? cwd
    : path.resolve(cwd, "packages/web-app");
}

function resolveMemoryRoot(): string {
  // This local file store is intended for the single-user template only.
  // In production, the application bundle may be read-only, and several server
  // processes may race while creating the seed files below. Use durable object
  // storage, such as a bucket with a separate prefix for each user's memory,
  // and create missing seed files atomically.
  const configuredRoot = process.env.WEB_APP_MEMORY_DIR?.trim() || ".data/memory";
  return path.resolve(resolveWebAppDirectory(), configuredRoot);
}

export async function createAgentProvider(): Promise<DeepAgent> {
  const store = createFileSystemMemoryStore({ rootDir: resolveMemoryRoot() });
  const repository = createMemoryRepository({ store });

  await Promise.all(
    createMemorySeedFiles().map(async (seed) => {
      if ((await repository.read(seed.path)) === null) {
        await repository.write(seed.path, seed.content);
      }
    }),
  );
  const modelRuntime = createModelRuntimeFromEnv({});

  return createScaffoldedAgent({
    generativeUi: { catalogPrompt },
    guardrails: false,
    imageGenerationService: createImageGenerationServiceFromEnv(),
    modelRuntime,
    store,
  });
}

// Worker-callable factory. Single-user template: the identity is ignored —
// every worker process serves the same single user. The agent is built once
// and cached for the process lifetime so the tool/store graph is not rebuilt
// on every turn.
let cachedWorkerAgent: Promise<DeepAgent> | null = null;

export async function createAgentForIdentity(_identity: ExecutionIdentity): Promise<DeepAgent> {
  if (cachedWorkerAgent) return cachedWorkerAgent;
  cachedWorkerAgent = createAgentProvider();
  void cachedWorkerAgent.catch(() => {
    cachedWorkerAgent = null;
  });
  return cachedWorkerAgent;
}

// No shared sandbox backend in the single-user template; no-op for the worker
// shutdown sequence.
export async function disposeSandboxBackend(): Promise<void> {}

export function __resetAgentCacheForTest(): void {
  cachedWorkerAgent = null;
}
