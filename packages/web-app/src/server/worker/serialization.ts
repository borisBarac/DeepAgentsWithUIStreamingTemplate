import type { ExecutionRequest } from "../agent-runtime/types.ts";

export const AGENT_TURN_QUEUE = "agent-turns";

export function bullMqQueuePrefix(keyPrefix: string): string {
  return keyPrefix.replace(/:+$/u, "");
}

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
