import path from "node:path";
import {
  connectLinkloomResearchTools,
  type LinkloomResearchConnection,
} from "@deep-agent-template/core";
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
  const linkloom = await resolveLinkloomConnection();

  return createScaffoldedAgent({
    generativeUi: { catalogPrompt },
    guardrails: false,
    imageGenerationService: createImageGenerationServiceFromEnv(),
    modelRuntime,
    ...(linkloom?.tools.length ? { additionalResearcherTools: linkloom.tools } : {}),
    store,
  });
}

// ============================================================================
// Linkloom MCP research tools
// ============================================================================
//
// One streamable-HTTP Linkloom connection per process. The tools are injected
// into the researcher subagent of every built agent via additionalResearcherTools.
// The connection is established lazily on first agent build and memoized: a
// failed attempt is cached as `null` so the process runs degraded (no Linkloom
// tools) for its lifetime, and retry happens on the next process restart.
let linkloomConnectionPromise: Promise<LinkloomResearchConnection | null> | null = null;

async function resolveLinkloomConnection(): Promise<LinkloomResearchConnection | null> {
  if (linkloomConnectionPromise) return linkloomConnectionPromise;
  linkloomConnectionPromise = (async () => {
    try {
      return await connectLinkloomResearchTools();
    } catch (error) {
      console.error(
        "[agent-provider] Linkloom MCP unavailable; starting without Linkloom tools.",
        error,
      );
      return null;
    }
  })();
  return linkloomConnectionPromise;
}

export async function disposeLinkloomConnection(): Promise<void> {
  const pending = linkloomConnectionPromise;
  linkloomConnectionPromise = null;
  if (!pending) return;
  const connection = await pending.catch(() => null);
  await connection?.close().catch(() => {
    // Best-effort during shutdown.
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

// Inject a Linkloom connection (or `null` for degraded mode) for tests, or pass
// `undefined` to restore lazy production resolution on the next build.
export function __setLinkloomConnectionForTest(
  connection: LinkloomResearchConnection | null | undefined,
): void {
  linkloomConnectionPromise = connection === undefined ? null : Promise.resolve(connection);
}
