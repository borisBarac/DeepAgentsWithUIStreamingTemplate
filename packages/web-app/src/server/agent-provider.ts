import {
  connectLinkloomResearchTools,
  connectSandboxTools,
  type LinkloomResearchConnection,
  type SandboxMcpConnection,
} from "@deep-agent-template/core";
import { createScaffoldedAgent, type DeepAgent } from "@deep-agent-template/core/agent";
import { catalogPrompt } from "@deep-agent-template/core/generative-ui";
import { createMemoryRepository, createMemorySeedFiles } from "@deep-agent-template/core/memory";
import { createModelRuntimeFromEnv } from "@deep-agent-template/core/models";
import { createImageGenerationServiceFromEnv } from "@deep-agent-template/image-gen";
import type { BaseStore } from "@langchain/langgraph";

import type { ExecutionIdentity } from "./agent-runtime/types.ts";
import { getSharedRedis, resolveRedisOptions } from "./redis/client.ts";
import { RedisMemoryStore } from "./redis/redis-memory-store.ts";

async function resolveMemoryStore(): Promise<BaseStore> {
  if (testMemoryStore) return testMemoryStore;
  const { keyPrefix } = resolveRedisOptions();
  const client = await getSharedRedis();
  return new RedisMemoryStore({ client, keyPrefix });
}

export async function createAgentProvider(): Promise<DeepAgent> {
  const store = await resolveMemoryStore();
  const repository = createMemoryRepository({ store });

  await Promise.all(
    createMemorySeedFiles().map(async (seed) => {
      if ((await repository.read(seed.path)) === null) {
        await repository.write(seed.path, seed.content);
      }
    }),
  );
  const modelRuntime = createModelRuntimeFromEnv({});
  const [linkloom, sandbox] = await Promise.all([
    resolveLinkloomConnection(),
    resolveSandboxConnection(),
  ]);

  return createScaffoldedAgent({
    generativeUi: { catalogPrompt },
    guardrails: false,
    imageGenerationService: createImageGenerationServiceFromEnv(),
    modelRuntime,
    ...(linkloom?.tools.length || sandbox?.tools.length
      ? { additionalResearcherTools: [...(linkloom?.tools ?? []), ...(sandbox?.tools ?? [])] }
      : {}),
    ...(sandbox?.tools.length ? { additionalAnalystTools: sandbox.tools } : {}),
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

// One streamable-HTTP sandbox connection per process. Like Linkloom, sandbox
// discovery failures degrade the worker rather than preventing agent startup.
let sandboxConnectionPromise: Promise<SandboxMcpConnection | null> | null = null;

async function resolveSandboxConnection(): Promise<SandboxMcpConnection | null> {
  if (sandboxConnectionPromise) return sandboxConnectionPromise;
  sandboxConnectionPromise = (async () => {
    try {
      return await connectSandboxTools();
    } catch (error) {
      console.error(
        "[agent-provider] Sandbox MCP unavailable; starting without Python tools.",
        error,
      );
      return null;
    }
  })();
  return sandboxConnectionPromise;
}

export async function disposeSandboxConnection(): Promise<void> {
  const pending = sandboxConnectionPromise;
  sandboxConnectionPromise = null;
  if (!pending) return;
  const connection = await pending.catch(() => null);
  await connection?.close().catch(() => {});
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

export function __resetAgentCacheForTest(): void {
  cachedWorkerAgent = null;
}

// Test-only override for the memory store. Pass a BaseStore (e.g. a
// FakeRedis-backed RedisMemoryStore) to bypass the real Redis client, or
// `undefined` to restore production resolution.
let testMemoryStore: BaseStore | null = null;

export function __setMemoryStoreForTest(store: BaseStore | null | undefined): void {
  testMemoryStore = store ?? null;
}

// Inject a Linkloom connection (or `null` for degraded mode) for tests, or pass
// `undefined` to restore lazy production resolution on the next build.
export function __setLinkloomConnectionForTest(
  connection: LinkloomResearchConnection | null | undefined,
): void {
  linkloomConnectionPromise = connection === undefined ? null : Promise.resolve(connection);
}

export function __setSandboxConnectionForTest(
  connection: SandboxMcpConnection | null | undefined,
): void {
  sandboxConnectionPromise = connection === undefined ? null : Promise.resolve(connection);
}
