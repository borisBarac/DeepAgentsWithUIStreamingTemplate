import { describe, expect, it } from "bun:test";

import type {
  AgentExecutionHandle,
  AgentExecutor,
  ExecutionEvent,
  ExecutionRequest,
  ExecutionResult,
} from "../../../src/server/agent-runtime/types.ts";
import {
  isSessionBusyError,
  makeSessionBusyError,
} from "../../../src/server/worker/bullmq-executor.ts";
import { createAgentCancellationHandler } from "./cancel/route.ts";
import { createAgentRequestHandler } from "./route.ts";

const SUCCESS_RESULT: ExecutionResult = {
  outcome: "success",
  failure: null,
  history: [],
  structuredOutput: null,
  finalText: "",
};

function fakeExecutor(events: ExecutionEvent[]): AgentExecutor {
  const result: ExecutionResult =
    events.find((e) => e.kind === "result")?.kind === "result"
      ? (events.find((e) => e.kind === "result") as { result: ExecutionResult }).result
      : SUCCESS_RESULT;

  return {
    execute(_request: ExecutionRequest, _signal: AbortSignal): Promise<AgentExecutionHandle> {
      const handle: AgentExecutionHandle = {
        events: {
          async *[Symbol.asyncIterator]() {
            for (const event of events) yield event;
          },
        },
        result: Promise.resolve(result),
      };
      return Promise.resolve(handle);
    },
    async cancel() {
      return { status: "requested" };
    },
  };
}

function fakeBusyExecutor(activeRunId: string): AgentExecutor {
  return {
    execute(_request: ExecutionRequest, _signal: AbortSignal): Promise<AgentExecutionHandle> {
      return Promise.reject(makeSessionBusyError(activeRunId));
    },
    async cancel() {
      return { status: "unknown" };
    },
  };
}

async function readNdjson(response: Response): Promise<unknown[]> {
  const text = await response.text();
  return text
    .trim()
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

describe("createAgentRequestHandler", () => {
  it("returns 400 when sessionId is missing", async () => {
    const handler = createAgentRequestHandler(fakeExecutor([]));
    const response = await handler(
      new Request("http://localhost/api/agent", {
        body: JSON.stringify({ message: "hi", runId: "r1" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 when message is missing", async () => {
    const handler = createAgentRequestHandler(fakeExecutor([]));
    const response = await handler(
      new Request("http://localhost/api/agent", {
        body: JSON.stringify({ runId: "r1", sessionId: "s1" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(400);
  });

  it("streams UI updates as NDJSON and hides lifecycle/result events", async () => {
    const events: ExecutionEvent[] = [
      { kind: "lifecycle", phase: "started" },
      { kind: "ui", update: { type: "message", text: "hello" } },
      { kind: "ui", update: { type: "message", text: "world" } },
      { kind: "result", result: SUCCESS_RESULT },
    ];
    const handler = createAgentRequestHandler(fakeExecutor(events));
    const response = await handler(
      new Request("http://localhost/api/agent", {
        body: JSON.stringify({ message: "hi", runId: "r1", sessionId: "s1" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/x-ndjson; charset=utf-8");

    const updates = await readNdjson(response);
    expect(updates).toHaveLength(2);
    expect(updates[0]).toEqual({ type: "message", text: "hello" });
    expect(updates[1]).toEqual({ type: "message", text: "world" });
  });

  it("returns 409 when the executor reports session busy", async () => {
    const handler = createAgentRequestHandler(fakeBusyExecutor("run-active-1"));
    const response = await handler(
      new Request("http://localhost/api/agent", {
        body: JSON.stringify({ message: "hi", runId: "r1", sessionId: "s1" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toContain("busy");
    expect(body.activeRunId).toBe("run-active-1");
  });

  it("returns 500 when the executor throws a non-busy error", async () => {
    const executor: AgentExecutor = {
      execute(): Promise<AgentExecutionHandle> {
        return Promise.reject(new Error("Redis connection refused"));
      },
      async cancel() {
        return { status: "unknown" };
      },
    };
    const handler = createAgentRequestHandler(executor);
    const response = await handler(
      new Request("http://localhost/api/agent", {
        body: JSON.stringify({ message: "hi", runId: "r1", sessionId: "s1" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(500);
  });

  it("streams an empty body when the executor emits only a result event", async () => {
    const events: ExecutionEvent[] = [{ kind: "result", result: SUCCESS_RESULT }];
    const handler = createAgentRequestHandler(fakeExecutor(events));
    const response = await handler(
      new Request("http://localhost/api/agent", {
        body: JSON.stringify({ message: "hi", runId: "r1", sessionId: "s1" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(200);
    const updates = await readNdjson(response);
    expect(updates).toEqual([]);
  });

  it("aborts the executor when response delivery is cancelled in debug mode", async () => {
    const original = process.env.NEXT_PUBLIC_AGENT_DEBUG;
    process.env.NEXT_PUBLIC_AGENT_DEBUG = "true";
    let aborted = false;
    const executor = fakeExecutor([]);
    executor.execute = async (_request, receivedSignal) => {
      receivedSignal.addEventListener("abort", () => {
        aborted = true;
      });
      return {
        events: {
          async *[Symbol.asyncIterator]() {
            await new Promise<never>(() => undefined);
          },
        },
        result: new Promise<never>(() => undefined),
      };
    };
    const response = await createAgentRequestHandler(executor)(
      new Request("http://localhost/api/agent", {
        body: JSON.stringify({ message: "hi", runId: "r1", sessionId: "s1" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    await response.body?.cancel();
    expect(aborted).toBe(true);
    process.env.NEXT_PUBLIC_AGENT_DEBUG = original;
  });

  it("aborts the executor from request.signal in debug mode", async () => {
    const original = process.env.NEXT_PUBLIC_AGENT_DEBUG;
    process.env.NEXT_PUBLIC_AGENT_DEBUG = "true";
    const controller = new AbortController();
    let aborted = false;
    const executor = fakeExecutor([]);
    executor.execute = async (_request, receivedSignal) => {
      receivedSignal.addEventListener("abort", () => {
        aborted = true;
      });
      return {
        events: {
          async *[Symbol.asyncIterator]() {
            await new Promise<never>(() => undefined);
          },
        },
        result: new Promise<never>(() => undefined),
      };
    };
    await createAgentRequestHandler(executor)(
      new Request("http://localhost/api/agent", {
        body: JSON.stringify({ message: "hi", runId: "r1", sessionId: "s1" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
        signal: controller.signal,
      }),
    );
    controller.abort();
    expect(aborted).toBe(true);
    process.env.NEXT_PUBLIC_AGENT_DEBUG = original;
  });

  it("does not abort the executor when response delivery is cancelled outside debug mode", async () => {
    const original = process.env.NEXT_PUBLIC_AGENT_DEBUG;
    process.env.NEXT_PUBLIC_AGENT_DEBUG = "false";
    let aborted = false;
    const executor = fakeExecutor([]);
    executor.execute = async (_request, signal) => {
      signal.addEventListener("abort", () => {
        aborted = true;
      });
      return {
        events: {
          async *[Symbol.asyncIterator]() {
            await new Promise<never>(() => undefined);
          },
        },
        result: new Promise<never>(() => undefined),
      };
    };
    const response = await createAgentRequestHandler(executor)(
      new Request("http://localhost/api/agent", {
        body: JSON.stringify({ message: "hi", runId: "r1", sessionId: "s1" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    await response.body?.cancel();
    expect(aborted).toBe(false);
    process.env.NEXT_PUBLIC_AGENT_DEBUG = original;
  });
});

describe("createAgentCancellationHandler", () => {
  for (const [result, expectedStatus] of [
    [{ status: "requested" }, 202],
    [{ status: "already_requested" }, 202],
    [{ status: "unknown" }, 404],
    [{ status: "terminal" }, 409],
  ] as const) {
    it(`returns ${expectedStatus} for ${result.status}`, async () => {
      const executor: AgentExecutor = {
        async cancel() {
          return result;
        },
        async execute() {
          throw new Error("unused");
        },
      };
      const response = await createAgentCancellationHandler(executor)(
        new Request("http://localhost/api/agent/cancel", {
          body: JSON.stringify({ runId: "r1" }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      );
      expect(response.status).toBe(expectedStatus);
      expect((await response.json()).status).toBe(result.status);
    });
  }
});

describe("isSessionBusyError + makeSessionBusyError", () => {
  it("creates an error with the activeRunId and session_busy code", () => {
    const error = makeSessionBusyError("run-42");
    expect(isSessionBusyError(error)).toBe(true);
    expect(error.activeRunId).toBe("run-42");
    expect(error.code).toBe("session_busy");
  });

  it("does not match generic errors", () => {
    expect(isSessionBusyError(new Error("nope"))).toBe(false);
  });
});
