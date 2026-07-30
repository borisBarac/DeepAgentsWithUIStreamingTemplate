import os from "node:os";
import path from "node:path";
import {
  connectLinkloomResearchTools,
  createManagedDockerSandboxBackend,
  InMemoryWorkflowStateStore,
  type LinkloomResearchConnection,
  type ManagedDockerSandboxBackend,
  type WorkflowStateStore,
} from "@deep-agent-template/core";
import { createScaffoldedAgent, type DeepAgent } from "@deep-agent-template/core/agent";
import { catalogPrompt } from "@deep-agent-template/core/generative-ui";
import {
  createInMemoryMemoryStore,
  createMemoryPolicy,
  createMemoryPolicyMiddleware,
  createMemoryRepository,
  createMemorySeedFiles,
} from "@deep-agent-template/core/memory";
import { createModelRuntimeFromEnv } from "@deep-agent-template/core/models";
import { createImageGenerationServiceFromEnv } from "@deep-agent-template/image-gen";
import type { BaseStore } from "@langchain/langgraph";

import type { ExecutionIdentity } from "./agent-runtime/types.ts";
import { isRedisConfigured } from "./redis/client.ts";

type GuestMemoryStore = BaseStore;

async function seedUserMemory(store: GuestMemoryStore, userId: string): Promise<void> {
  const repository = createMemoryRepository({ store, userId });
  await Promise.all(
    createMemorySeedFiles().map(async (seed) => {
      if ((await repository.read(seed.path)) === null) {
        await repository.write(seed.path, seed.content);
      }
    }),
  );
}

type SandboxIdentity = { readonly tenantId: string; readonly userId: string };

function positiveNumber(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

// Local Docker execution and this in-process queue must move to online workers
// for production scaling, distributed admission control, and tenant isolation.
const sandboxSuffix = `${process.pid}-${crypto.randomUUID()}`;
const sharedSandboxBackend: ManagedDockerSandboxBackend = createManagedDockerSandboxBackend({
  containerName: `web-app-sandbox-${sandboxSuffix}`,
  workspaceRoot: path.join(os.tmpdir(), `web-app-sandbox-${sandboxSuffix}`),
  cpus: positiveNumber(process.env.WEB_APP_SANDBOX_CPUS, 2.5),
  memory: process.env.WEB_APP_SANDBOX_MEMORY?.trim() || "1280m",
  maxConcurrency: 5,
  queueCapacity: 25,
});

export async function disposeSandboxBackend(): Promise<void> {
  await sharedSandboxBackend.dispose();
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

// ============================================================================
// Guest memory + workflow state stores
// ============================================================================
//
// When REDIS_URL is configured, both the memory BaseStore and the workflow
// state store are backed by Redis so worker processes share state across
// instances and restarts. When REDIS_URL is unset in isolated unit tests, both
// remain in-process. The store singletons are resolved once at
// module load; tests can reset via __resetGuestMemoryForTest.
type ResolvedStores =
  | {
      readonly kind: "memory";
      readonly memory: GuestMemoryStore;
      readonly workflow: WorkflowStateStore;
    }
  | {
      readonly kind: "redis";
      readonly memory: import("./redis/redis-memory-store.ts").RedisMemoryStore;
      readonly workflow: import("./redis/redis-workflow-state-store.ts").RedisWorkflowStateStore;
    };

let resolvedStores: ResolvedStores | null = null;

async function resolveStores(): Promise<ResolvedStores> {
  if (resolvedStores) return resolvedStores;
  if (!isRedisConfigured()) {
    resolvedStores = {
      kind: "memory",
      memory: createInMemoryMemoryStore(),
      workflow: new InMemoryWorkflowStateStore(),
    };
    return resolvedStores;
  }
  const { getSharedRedis, resolveRedisOptions } = await import("./redis/client.ts");
  const { RedisMemoryStore } = await import("./redis/redis-memory-store.ts");
  const { RedisWorkflowStateStore } = await import("./redis/redis-workflow-state-store.ts");
  const { keyPrefix } = resolveRedisOptions();
  const client = await getSharedRedis();
  resolvedStores = {
    kind: "redis",
    memory: new RedisMemoryStore({ client, keyPrefix }),
    workflow: new RedisWorkflowStateStore({ client, keyPrefix }),
  } as ResolvedStores;
  return resolvedStores;
}

// Compatibility shim: code paths that need the store synchronously still
// import this getter. It returns the in-memory singleton; if Redis was
// requested, callers MUST use resolveStores() instead. Used only by tests.
function guestMemoryStore(): GuestMemoryStore {
  if (resolvedStores?.kind === "memory") return resolvedStores.memory;
  return inMemoryFallback;
}

// Always-initialized in-memory fallback so legacy sync getters keep working
// in tests that don't await resolveStores(). Production overwrites this with
// a Redis-backed store on first agent creation.
const inMemoryFallback: GuestMemoryStore = createInMemoryMemoryStore();

// ============================================================================
// Agent cache (LRU-bounded)
// ============================================================================
//
// One scaffolded agent per guest. Unbounded, this map would grow one entry
// per unique guest UUID for the lifetime of the process — eventually OOM as
// the agent tool graph and store repository are retained.
//
// We bound it with a small LRU. On every hit we delete-then-set to refresh
// recency (Map iteration order is insertion order in JS). When the cache
// exceeds MAX_CACHED_GUEST_AGENTS, the oldest entry is dropped.
//
// NOTE: the agent cache stays process-local even when REDIS_URL is set. The
// cache is only a rebuild optimization — discarding it on a fresh process is
// correct, just slower for the first turn after restart.
const DEFAULT_MAX_CACHED_GUEST_AGENTS = 64;
function resolveMaxCachedGuestAgents(): number {
  const raw = process.env.WEB_APP_MAX_CACHED_GUEST_AGENTS;
  if (!raw) return DEFAULT_MAX_CACHED_GUEST_AGENTS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return DEFAULT_MAX_CACHED_GUEST_AGENTS;
  return parsed;
}
let maxCachedGuestAgents = resolveMaxCachedGuestAgents();

const agentCache = new Map<string, Promise<DeepAgent>>();
function agentCacheKey(identity: SandboxIdentity): string {
  return `${identity.tenantId}\0${identity.userId}`;
}

function rememberAgent(key: string, promise: Promise<DeepAgent>): void {
  agentCache.delete(key);
  agentCache.set(key, promise);
  while (agentCache.size > maxCachedGuestAgents) {
    const oldest = agentCache.keys().next().value;
    if (oldest === undefined) break;
    agentCache.delete(oldest);
  }
}

function buildAgent(args: {
  readonly store: BaseStore;
  readonly workflowStore: WorkflowStateStore;
  readonly memoryUserId: string;
  readonly sandboxIdentity: SandboxIdentity | undefined;
  readonly researcherTools: LinkloomResearchConnection["tools"];
}): DeepAgent {
  const modelRuntime = createModelRuntimeFromEnv({});
  const memoryPolicy = createMemoryPolicy();
  return createScaffoldedAgent({
    generativeUi: { catalogPrompt },
    guardrails: false,
    imageGenerationService: createImageGenerationServiceFromEnv(),
    memoryUserId: args.memoryUserId,
    middleware: [createMemoryPolicyMiddleware(memoryPolicy)],
    modelRuntime,
    pythonSandboxBackend: sharedSandboxBackend,
    sandboxIdentity: args.sandboxIdentity,
    ...(args.researcherTools.length > 0 ? { additionalResearcherTools: args.researcherTools } : {}),
    store: args.store,
    workflowStateStore: args.workflowStore,
  });
}

// Per-identity factory used by the agent executor. Memory is scoped by user
// via the repository namespace within the shared in-memory store. The
// scaffolded agent is memoized per guest so the tool/store graph is built
// once.
export async function createAgentForIdentity(identity: ExecutionIdentity): Promise<DeepAgent> {
  const key = agentCacheKey(identity);
  const cached = agentCache.get(key);
  if (cached) {
    // Refresh LRU recency on hit so active guests survive eviction.
    agentCache.delete(key);
    agentCache.set(key, cached);
    return cached;
  }

  const promise = (async (): Promise<DeepAgent> => {
    const stores = await resolveStores();
    await seedUserMemory(stores.memory, identity.userId);
    const linkloom = await resolveLinkloomConnection();
    return buildAgent({
      memoryUserId: identity.userId,
      researcherTools: linkloom?.tools ?? [],
      sandboxIdentity: identity,
      store: stores.memory,
      workflowStore: stores.workflow,
    });
  })();

  rememberAgent(key, promise);
  void promise.catch(() => {
    if (agentCache.get(key) === promise) agentCache.delete(key);
  });
  return promise;
}

// --- Test seams -------------------------------------------------------------
export function __getGuestMemoryStoreForTest(): GuestMemoryStore {
  return guestMemoryStore();
}

export function __resetGuestMemoryForTest(): void {
  agentCache.clear();
  resolvedStores = {
    kind: "memory",
    memory: createInMemoryMemoryStore(),
    workflow: new InMemoryWorkflowStateStore(),
  };
  // Tests do not exercise the live Linkloom HTTP service. Pin the connection
  // to a resolved `null` (degraded, no tools, no network) so agent builds stay
  // hermetic. Tests that need tools inject them via __setLinkloomConnectionForTest.
  linkloomConnectionPromise = Promise.resolve(null);
}

// Inject a Linkloom connection (or `null` for degraded mode) for tests, or pass
// `undefined` to restore lazy production resolution on the next build.
export function __setLinkloomConnectionForTest(
  connection: LinkloomResearchConnection | null | undefined,
): void {
  linkloomConnectionPromise = connection === undefined ? null : Promise.resolve(connection);
}

export function __getMaxCachedGuestAgentsForTest(): number {
  return maxCachedGuestAgents;
}

export function __setMaxCachedGuestAgentsForTest(cap: number): void {
  if (!Number.isSafeInteger(cap) || cap <= 0) {
    throw new Error(`__setMaxCachedGuestAgentsForTest: expected positive integer, got ${cap}`);
  }
  maxCachedGuestAgents = cap;
  while (agentCache.size > maxCachedGuestAgents) {
    const oldest = agentCache.keys().next().value;
    if (oldest === undefined) break;
    agentCache.delete(oldest);
  }
}

export function __getAgentCacheSizeForTest(): number {
  return agentCache.size;
}
