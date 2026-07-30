import { createHash } from "node:crypto";
import type { ExecutionIdentity } from "../agent-runtime/types.ts";

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
  runState(runId: string, identity?: ExecutionIdentity): string;
  runStream(runId: string, identity?: ExecutionIdentity): string;
  sessionLock(tenantId: string, userId: string, sessionId: string): string;
  cancellation(runId: string, identity?: ExecutionIdentity): string;
  memoryNamespaceIndex(namespaceHash: string): string;
  memoryItem(namespaceHash: string, key: string): string;
  memoryNamespaceExpiry(namespaceHash: string): string;
  memoryNamespaceRegistry(): string;
};

export const DEFAULT_TTL_SECONDS = {
  session: 1_800,
  runMetadata: 1_800,
  runState: 1_800,
  runStream: 1_800,
  cancellation: 1_800,
} as const;

export type TtlConfig = Partial<Record<keyof typeof DEFAULT_TTL_SECONDS, number>>;

export function resolveTtlConfig(
  overrides?: TtlConfig,
): Record<keyof typeof DEFAULT_TTL_SECONDS, number> {
  return { ...DEFAULT_TTL_SECONDS, ...overrides };
}

export const DEFAULT_LOCK_LEASE_SECONDS = 90;

export function createRedisKeys(keyPrefix: string): RedisKeyspaces {
  const sessionsBase = `${keyPrefix}session:`;
  const runsBase = `${keyPrefix}run:`;
  const streamsBase = `${keyPrefix}stream:`;
  const memoryBase = `${keyPrefix}memory:`;
  const locksBase = `${keyPrefix}lock:`;
  const cancelBase = `${keyPrefix}cancel:`;
  const scopedRunKey = (base: string, runId: string, identity?: ExecutionIdentity) =>
    identity ? `${base}${sha256Digest(identityMaterial(identity, runId))}` : `${base}${runId}`;

  return {
    runMetadata(tenantId, userId, sessionId) {
      return `${sessionsBase}runmeta:${sha256Digest(
        identityMaterial({ tenantId, userId }, sessionId),
      )}`;
    },
    runState(runId, identity) {
      return scopedRunKey(`${runsBase}state:`, runId, identity);
    },
    runStream(runId, identity) {
      return scopedRunKey(streamsBase, runId, identity);
    },
    sessionLock(tenantId, userId, sessionId) {
      return `${locksBase}${sha256Digest(identityMaterial({ tenantId, userId }, sessionId))}`;
    },
    cancellation(runId, identity) {
      return scopedRunKey(cancelBase, runId, identity);
    },
    memoryNamespaceIndex(namespaceHash) {
      return `${memoryBase}idx:${namespaceHash}`;
    },
    memoryItem(namespaceHash, key) {
      return `${memoryBase}item:${namespaceHash}:${sha256Digest(key)}`;
    },
    memoryNamespaceExpiry(namespaceHash) {
      return `${memoryBase}expiry:${namespaceHash}`;
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
  };
}

export function hashNamespace(namespace: readonly string[]): string {
  return sha256Digest(namespace.join(NULL));
}
