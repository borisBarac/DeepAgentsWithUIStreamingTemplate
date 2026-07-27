import os from "node:os";
import path from "node:path";
import {
  createManagedDockerSandboxBackend,
  InMemoryWorkflowStateStore,
  type ManagedDockerSandboxBackend,
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

import type { ExecutionIdentity } from "./agent-runtime/types.ts";

type GuestMemoryStore = ReturnType<typeof createInMemoryMemoryStore>;

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
// Guest memory store
// ============================================================================
//
// All guests share ONE process-wide InMemoryStore. Per-guest isolation comes
// from the memory repository's namespace (`["users", "<encoded-id>", "memory"]`
// via `createUserMemoryNamespace`), not from per-user store instances.
//
// MEMORY IS EPHEMERAL. Guest memory lives only in this process and is lost:
//   - on process restart,
//   - when the agent cache evicts the guest (LRU eviction is bounded — see
//     DeepAgentTemplate-htgo), and
//   - on cold boot of any new instance behind a load balancer (no sharing
//     across instances).
//
// This is intentional for the anonymous-guest model: every user is a guest
// with no authentication and no promise of cross-restart continuity. When
// durable storage is needed, replace this singleton with a `BucketMemoryStore`
// (S3-backed) — see DeepAgentTemplate-58p3.
let guestMemoryStore: GuestMemoryStore = createInMemoryMemoryStore();
// Separate from LangGraph memory so workflow state can outlive a cached agent
// instance while remaining process-local.
let guestWorkflowStateStore = new InMemoryWorkflowStateStore();

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
// exceeds MAX_CACHED_GUEST_AGENTS, the oldest entry is dropped. A dropped
// agent's per-guest memory lives on inside the shared in-memory store until
// THAT store is replaced (process restart) — so an evicted guest coming back
// gets a fresh agent but resumes their memory immediately (within the
// process lifetime).
//
// Configure the cap via WEB_APP_MAX_CACHED_GUEST_AGENTS (positive integer).
const DEFAULT_MAX_CACHED_GUEST_AGENTS = 64;
function resolveMaxCachedGuestAgents(): number {
  const raw = process.env.WEB_APP_MAX_CACHED_GUEST_AGENTS;
  if (!raw) return DEFAULT_MAX_CACHED_GUEST_AGENTS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return DEFAULT_MAX_CACHED_GUEST_AGENTS;
  return parsed;
}
// `let` so tests can shrink the cap via __setMaxCachedGuestAgentsForTest.
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
  readonly store: GuestMemoryStore;
  readonly memoryUserId: string;
  readonly sandboxIdentity: SandboxIdentity | undefined;
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
    store: args.store,
    workflowStateStore: guestWorkflowStateStore,
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
    await seedUserMemory(guestMemoryStore, identity.userId);
    return buildAgent({
      memoryUserId: identity.userId,
      sandboxIdentity: identity,
      store: guestMemoryStore,
    });
  })();

  rememberAgent(key, promise);
  // Drop the cache entry on failure so a transient init error is retried.
  void promise.catch(() => {
    if (agentCache.get(key) === promise) agentCache.delete(key);
  });
  return promise;
}

// --- Test seams -------------------------------------------------------------
// The guest store is a process-wide singleton; tests reset it between cases to
// avoid cross-test pollution. Agent cache is also cleared so the next call
// re-builds against the fresh store.
export function __getGuestMemoryStoreForTest(): GuestMemoryStore {
  return guestMemoryStore;
}

export function __resetGuestMemoryForTest(): void {
  agentCache.clear();
  guestMemoryStore = createInMemoryMemoryStore();
  guestWorkflowStateStore = new InMemoryWorkflowStateStore();
}

export function __getMaxCachedGuestAgentsForTest(): number {
  return maxCachedGuestAgents;
}

export function __setMaxCachedGuestAgentsForTest(cap: number): void {
  if (!Number.isSafeInteger(cap) || cap <= 0) {
    throw new Error(`__setMaxCachedGuestAgentsForTest: expected positive integer, got ${cap}`);
  }
  maxCachedGuestAgents = cap;
  // Evict immediately so the new cap is enforced without waiting for the next
  // miss to trigger the while-loop in rememberAgent.
  while (agentCache.size > maxCachedGuestAgents) {
    const oldest = agentCache.keys().next().value;
    if (oldest === undefined) break;
    agentCache.delete(oldest);
  }
}

export function __getAgentCacheSizeForTest(): number {
  return agentCache.size;
}
