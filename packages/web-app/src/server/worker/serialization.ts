import type { ExecutionRequest } from "../agent-runtime/types.ts";

// The BullMQ queue NAME. Both the API (which enqueues) and the worker (which
// consumes) must use the same name; centralizing it avoids drift. BullMQ v5
// forbids ':' in the queue name (its QueueBase constructor builds Redis keys as
// `<prefix>:<queueName>:<suffix>`), so the namespace prefix is supplied
// separately via {@link bullMqQueuePrefix} rather than baked into this name.
// Together they reproduce the original `dat:agent-turns:*` Redis key layout.
export const AGENT_TURN_QUEUE = "agent-turns";

// BullMQ inserts the ':' separator itself (key = prefix + ":" + name + ":" +
// suffix), so the prefix must NOT carry a trailing colon. REDIS_KEY_PREFIX is
// conventionally colon-terminated (e.g. "dat:"), so we strip any trailing
// colons before handing it to BullMQ. This keeps the resulting Redis keys
// identical to the previous `dat:agent-turns:*` layout.
export function bullMqQueuePrefix(keyPrefix: string): string {
  return keyPrefix.replace(/:+$/u, "");
}

// Serialize an ExecutionRequest for BullMQ. The request is already shaped for
// cross-process transport (identity, sessionId, runId, messages, options,
// traceContext are all JSON-serializable). We wrap it in an envelope so future
// schema changes are detectable without ambiguity.
//
// v2 adds `fencingToken`: the fencing token assigned when the API acquired the
// session lock. The worker validates it against the live lock record before
// starting the turn, so a stale job (whose lock has expired and been
// re-acquired by a newer run) is rejected rather than silently overwriting
// another owner's session.
export const EXECUTION_REQUEST_SCHEMA_VERSION = 2;

export type ExecutionRequestEnvelope = {
  readonly v: number;
  readonly request: ExecutionRequest;
  readonly fencingToken: number;
};

export type DecodedExecutionRequest = {
  readonly request: ExecutionRequest;
  readonly fencingToken: number;
};

export function encodeExecutionRequest(
  request: ExecutionRequest,
  fencingToken: number,
): ExecutionRequestEnvelope {
  return { fencingToken, request, v: EXECUTION_REQUEST_SCHEMA_VERSION };
}

export function decodeExecutionRequest(envelope: unknown): DecodedExecutionRequest {
  if (!envelope || typeof envelope !== "object") {
    throw new Error("Invalid execution request envelope: expected an object.");
  }
  const record = envelope as { v?: unknown; request?: unknown; fencingToken?: unknown };
  if (record.v !== EXECUTION_REQUEST_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported execution request schema: got ${String(record.v)}, expected ${EXECUTION_REQUEST_SCHEMA_VERSION}.`,
    );
  }
  if (!record.request || typeof record.request !== "object") {
    throw new Error("Invalid execution request envelope: missing request payload.");
  }
  const fencingToken = Number(record.fencingToken);
  if (!Number.isFinite(fencingToken)) {
    throw new Error("Invalid execution request envelope: fencingToken must be a finite number.");
  }
  return { fencingToken, request: record.request as ExecutionRequest };
}
