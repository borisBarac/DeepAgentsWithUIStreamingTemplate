import { describe, expect, it } from "bun:test";
import type { ExecutionRequest } from "../agent-runtime/types.ts";
import {
  AGENT_TURN_QUEUE,
  bullMqQueuePrefix,
  decodeExecutionRequest,
  EXECUTION_REQUEST_SCHEMA_VERSION,
  encodeExecutionRequest,
} from "./serialization.ts";

function sampleRequest(overrides: Partial<ExecutionRequest> = {}): ExecutionRequest {
  return {
    identity: { tenantId: "tenant-a", userId: "user-1" },
    messages: [{ content: "hi", role: "user" }],
    options: { includeActivity: false, requireStructuredOutput: true },
    runId: "00000000-0000-4000-8000-000000000001",
    sessionId: "session-1",
    traceContext: { traceparent: "00-trace-span-01", tracestate: "vendor=dat" },
    ...overrides,
  };
}

describe("encodeExecutionRequest + decodeExecutionRequest", () => {
  it("wraps the request in an envelope tagged with the schema version and fencing token", () => {
    const request = sampleRequest();
    const envelope = encodeExecutionRequest(request, 42);
    expect(envelope.v).toBe(EXECUTION_REQUEST_SCHEMA_VERSION);
    expect(envelope.request).toEqual(request);
    expect(envelope.fencingToken).toBe(42);
  });

  it("round-trips through encode → decode", () => {
    const request = sampleRequest({
      runId: "abc-123",
      traceContext: { traceparent: "00-0-0-01" },
    });
    const decoded = decodeExecutionRequest(encodeExecutionRequest(request, 7));
    expect(decoded.request).toEqual(request);
    expect(decoded.fencingToken).toBe(7);
  });

  it("rejects non-object envelopes", () => {
    expect(() => decodeExecutionRequest(null)).toThrow(/expected an object/i);
    expect(() => decodeExecutionRequest("not-an-object")).toThrow(/expected an object/i);
    expect(() => decodeExecutionRequest(42)).toThrow(/expected an object/i);
  });

  it("rejects unsupported schema versions", () => {
    const bad = { fencingToken: 1, request: sampleRequest(), v: 999 };
    expect(() => decodeExecutionRequest(bad)).toThrow(/Unsupported execution request schema/i);
  });

  it("rejects envelopes missing the request payload", () => {
    expect(() =>
      decodeExecutionRequest({ fencingToken: 1, v: EXECUTION_REQUEST_SCHEMA_VERSION }),
    ).toThrow(/missing request payload/i);
    expect(() =>
      decodeExecutionRequest({
        fencingToken: 1,
        v: EXECUTION_REQUEST_SCHEMA_VERSION,
        request: "nope",
      }),
    ).toThrow(/missing request payload/i);
  });

  it("rejects envelopes with a missing or non-finite fencing token", () => {
    expect(() =>
      decodeExecutionRequest({ v: EXECUTION_REQUEST_SCHEMA_VERSION, request: sampleRequest() }),
    ).toThrow(/fencingToken/i);
    expect(() =>
      decodeExecutionRequest({
        fencingToken: NaN,
        request: sampleRequest(),
        v: EXECUTION_REQUEST_SCHEMA_VERSION,
      }),
    ).toThrow(/fencingToken/i);
  });
});

describe("AGENT_TURN_QUEUE", () => {
  it("is a stable string so the API and worker share the queue name", () => {
    expect(typeof AGENT_TURN_QUEUE).toBe("string");
    expect(AGENT_TURN_QUEUE.length).toBeGreaterThan(0);
  });

  // BullMQ's QueueBase constructor rejects ':' in the queue name — it composes
  // Redis keys as `<prefix>:<name>:<suffix>` itself. The namespace must ride on
  // the `prefix` option (see bullMqQueuePrefix), not the name.
  it("contains no ':' so BullMQ accepts it as the queue name", () => {
    expect(AGENT_TURN_QUEUE).not.toContain(":");
  });
});

describe("bullMqQueuePrefix", () => {
  it("strips a trailing colon from a conventional REDIS_KEY_PREFIX", () => {
    expect(bullMqQueuePrefix("dat:")).toBe("dat");
  });

  it("strips repeated trailing colons", () => {
    expect(bullMqQueuePrefix("dat::")).toBe("dat");
  });

  it("leaves a prefix without a trailing colon unchanged", () => {
    expect(bullMqQueuePrefix("dat")).toBe("dat");
  });

  it("returns an empty string for an all-colon prefix", () => {
    expect(bullMqQueuePrefix(":::")).toBe("");
  });
});
