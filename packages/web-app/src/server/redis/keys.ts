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
  runState(runId: string): string;
  runStream(runId: string): string;
  sessionLock(tenantId: string, userId: string, sessionId: string): string;
  cancellation(runId: string): string;
};

export const DEFAULT_TTL_SECONDS = {
  session: 60 * 60 * 12,
  runMetadata: 60 * 60 * 24 * 7,
  runState: 60 * 60,
  runStream: 60 * 60,
  cancellation: 60 * 60,
} as const;

export type TtlConfig = Partial<typeof DEFAULT_TTL_SECONDS>;

export function resolveTtlConfig(overrides?: TtlConfig): typeof DEFAULT_TTL_SECONDS {
  return { ...DEFAULT_TTL_SECONDS, ...overrides };
}

export const DEFAULT_LOCK_LEASE_SECONDS = 90;

export function createRedisKeys(keyPrefix: string): RedisKeyspaces {
  const sessionsBase = `${keyPrefix}session:`;
  const runsBase = `${keyPrefix}run:`;
  const streamsBase = `${keyPrefix}stream:`;
  const locksBase = `${keyPrefix}lock:`;
  const cancelBase = `${keyPrefix}cancel:`;

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
