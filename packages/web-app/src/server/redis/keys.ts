import { createHash } from "node:crypto";
import type { ExecutionIdentity } from "../agent-runtime/types.ts";

// Centralized Redis key namespaces. Each concern gets a distinct prefix under
// the configured REDIS_KEY_PREFIX so they can be reasoned about and TTL'd
// independently. Key prefixes never appear in user-visible identifiers.
//
// Format: `{keyPrefix}{concern}:{opaqueHashOrId}`. createRedisKeys() is the
// single owner of the prefix: it bakes the full keyPrefix into every key it
// returns, and the shared ioredis client (getSharedRedis) does NOT forward
// keyPrefix to ioredis, so keys are transmitted on the wire exactly as built
// here (no double prefix). The BullMQ client (getBullMqRedis) likewise omits
// keyPrefix.

const NULL = "\u0000";

export function identityMaterial(identity: ExecutionIdentity, sessionId: string): string {
  return `${identity.tenantId}${NULL}${identity.userId}${NULL}${sessionId}`;
}

function sha256Digest(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export type RedisKeyspaces = {
  session(tenantId: string, userId: string, sessionId: string): string;
  sessionVersion(tenantId: string, userId: string, sessionId: string): string;
  runMetadata(tenantId: string, userId: string, sessionId: string): string;
  runState(runId: string): string;
  runStream(runId: string): string;
  sessionLock(tenantId: string, userId: string, sessionId: string): string;
  cancellation(runId: string): string;
  memoryNamespaceIndex(namespaceHash: string): string;
  memoryItem(namespaceHash: string, key: string): string;
  memoryNamespaceRegistry(): string;
  workflowState(threadId: string): string;
};

export const DEFAULT_TTL_SECONDS = {
  // Sessions are retained for half a day; commits refresh this window.
  session: 60 * 60 * 12,
  // Run metadata remains available for longer-lived diagnostics.
  runMetadata: 60 * 60 * 24 * 7,
  // Run state + streams are kept long enough for the API to read final state
  // after a worker finishes; trimmed aggressively.
  runState: 60 * 60,
  runStream: 60 * 60,
  // Workflow state survives as long as sessions do.
  workflowState: 60 * 60 * 24 * 7,
  // Cancellation flag is short-lived — workers poll frequently.
  cancellation: 60 * 60,
} as const;

export type TtlConfig = Partial<typeof DEFAULT_TTL_SECONDS>;

export function resolveTtlConfig(overrides?: TtlConfig): typeof DEFAULT_TTL_SECONDS {
  return { ...DEFAULT_TTL_SECONDS, ...overrides };
}

// Default session-lock lease. It must outlive the one-minute maximum queue
// wait, then workers refresh it on a cadence of ~1/3 of the lease.
export const DEFAULT_LOCK_LEASE_SECONDS = 90;

// Namespaced key builder. Takes the configured keyPrefix (e.g. "dat:") so the
// keyspaces here are full prefix strings ready to use with ioredis.
export function createRedisKeys(keyPrefix: string): RedisKeyspaces {
  const sessionsBase = `${keyPrefix}session:`;
  const runsBase = `${keyPrefix}run:`;
  const streamsBase = `${keyPrefix}stream:`;
  const memoryBase = `${keyPrefix}memory:`;
  const locksBase = `${keyPrefix}lock:`;
  const cancelBase = `${keyPrefix}cancel:`;
  const workflowBase = `${keyPrefix}workflow:`;

  return {
    runMetadata(tenantId, userId, sessionId) {
      return `${sessionsBase}runmeta:${sha256Digest(
        identityMaterial({ tenantId, userId }, sessionId),
      )}`;
    },
    runState(runId) {
      return `${runsBase}state:${runId}`;
    },
    runStream(runId) {
      return `${streamsBase}${runId}`;
    },
    sessionLock(tenantId, userId, sessionId) {
      return `${locksBase}${sha256Digest(identityMaterial({ tenantId, userId }, sessionId))}`;
    },
    cancellation(runId) {
      return `${cancelBase}${runId}`;
    },
    memoryNamespaceIndex(namespaceHash) {
      return `${memoryBase}idx:${namespaceHash}`;
    },
    memoryItem(namespaceHash, key) {
      return `${memoryBase}item:${namespaceHash}:${sha256Digest(key)}`;
    },
    memoryNamespaceRegistry() {
      return `${memoryBase}namespaces`;
    },
    session(tenantId, userId, sessionId) {
      return `${sessionsBase}state:${sha256Digest(
        identityMaterial({ tenantId, userId }, sessionId),
      )}`;
    },
    sessionVersion(tenantId, userId, sessionId) {
      return `${sessionsBase}ver:${sha256Digest(
        identityMaterial({ tenantId, userId }, sessionId),
      )}`;
    },
    workflowState(threadId) {
      return `${workflowBase}${threadId}`;
    },
  };
}

// Stable hash of a namespace tuple so memory keys stay short and structureless.
export function hashNamespace(namespace: readonly string[]): string {
  return sha256Digest(namespace.join(NULL));
}
