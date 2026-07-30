import { describe, expect, it } from "bun:test";
import type {
  AgentExecutionHandle,
  AgentExecutor,
  ExecutionEvent,
  ExecutionRequest,
  ExecutionResult,
} from "../../../src/server/agent-runtime/types.ts";
import { GUEST_ID_HEADER, GUEST_TENANT_ID } from "../../../src/server/identity.ts";
import {
  makeSessionBusyError,
  type SessionBusyError,
} from "../../../src/server/worker/bullmq-executor.ts";
import { createAgentRequestHandler } from "./route.ts";

const DEFAULT_GUEST_ID = "00000000-0000-4000-8000-000000000001";

function agentRequest(
  body: string,
  options: { guestId?: string; includeSubagentActivity?: boolean } = {},
): Request {
  const payload = JSON.parse(body) as Record<string, unknown>;
  const nextPayload: Record<string, unknown> = { ...payload };
  if (options.includeSubagentActivity !== undefined) {
    nextPayload.includeSubagentActivity = options.includeSubagentActivity;
  }
  return new Request("http://localhost/api/agent", {
    body: JSON.stringify(nextPayload),
    headers: {
      "Content-Type": "application/json",
      [GUEST_ID_HEADER]: options.guestId ?? DEFAULT_GUEST_ID,
    },
    method: "POST",
  });
}

function guestAgentRequest(args: {
  message: string;
  sessionId: string;
  guestId?: string;
  includeSubagentActivity?: boolean;
}): Request {
  return agentRequest(JSON.stringify({ message: args.message, sessionId: args.sessionId }), {
    guestId: args.guestId,
    includeSubagentActivity: args.includeSubagentActivity,
  });
}

const SUCCESS_RESULT: ExecutionResult = {
  outcome: "success",
  failure: null,
  history: [],
  structuredOutput: null,
  finalText: "",
};

// Fake executor that captures the request + signal and emits a controlled
// stream of ExecutionEvents. Replaces the old injected-agent mocks.
type CapturedCall = {
  request: ExecutionRequest;
  signal: AbortSignal;
};

function asyncIterableFrom<T>(items: T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}

function fakeExecutor(options: {
  events?: ExecutionEvent[];
  result?: ExecutionResult;
  throwOnExecute?: Error;
}): { executor: AgentExecutor; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const executor: AgentExecutor = {
    async execute(request, signal): Promise<AgentExecutionHandle> {
      calls.push({ request, signal });
      if (options.throwOnExecute) throw options.throwOnExecute;
      const events = options.events ?? [];
      const handle: AgentExecutionHandle = {
        events: asyncIterableFrom(events),
        result: Promise.resolve(options.result ?? extractResult(events) ?? SUCCESS_RESULT),
      };
      return handle;
    },
  };
  return { executor, calls };
}

function extractResult(events: ExecutionEvent[]): ExecutionResult | null {
  for (const event of events) {
    if (event.kind === "result") return event.result;
  }
  return null;
}

async function readNdjson(response: Response): Promise<unknown[]> {
  const text = await response.text();
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown);
}

function makeUiUpdate(text: string): ExecutionEvent {
  return { kind: "ui", update: { type: "message", text } };
}

describe("createAgentRequestHandler — request parsing", () => {
  it("rejects a non-object body with 400", async () => {
    const { executor } = fakeExecutor({});
    const handler = createAgentRequestHandler(executor);
    const response = await handler(
      new Request("http://localhost/api/agent", {
        body: '"just a string"',
        headers: { "Content-Type": "application/json", [GUEST_ID_HEADER]: DEFAULT_GUEST_ID },
        method: "POST",
      }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/object/i);
  });

  it("rejects a missing sessionId with 400", async () => {
    const { executor } = fakeExecutor({});
    const handler = createAgentRequestHandler(executor);
    const response = await handler(
      new Request("http://localhost/api/agent", {
        body: JSON.stringify({ message: "hello" }),
        headers: { "Content-Type": "application/json", [GUEST_ID_HEADER]: DEFAULT_GUEST_ID },
        method: "POST",
      }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/sessionId/i);
  });

  it("rejects a missing message with 400", async () => {
    const { executor } = fakeExecutor({});
    const handler = createAgentRequestHandler(executor);
    const response = await handler(
      new Request("http://localhost/api/agent", {
        body: JSON.stringify({ sessionId: "s1" }),
        headers: { "Content-Type": "application/json", [GUEST_ID_HEADER]: DEFAULT_GUEST_ID },
        method: "POST",
      }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/message/i);
  });

  it("rejects invalid JSON with 400", async () => {
    const { executor } = fakeExecutor({});
    const handler = createAgentRequestHandler(executor);
    const response = await handler(
      new Request("http://localhost/api/agent", {
        body: "{not json",
        headers: { "Content-Type": "application/json", [GUEST_ID_HEADER]: DEFAULT_GUEST_ID },
        method: "POST",
      }),
    );
    expect(response.status).toBe(400);
  });
});

describe("createAgentRequestHandler — guest identity", () => {
  it("rejects requests without an x-guest-id header with 400", async () => {
    const { executor } = fakeExecutor({});
    const handler = createAgentRequestHandler(executor);
    const response = await handler(
      new Request("http://localhost/api/agent", {
        body: JSON.stringify({ message: "hello", sessionId: "s1" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/x-guest-id/i);
  });

  it("rejects a malformed x-guest-id header with 400", async () => {
    const { executor } = fakeExecutor({});
    const handler = createAgentRequestHandler(executor);
    const response = await handler(
      new Request("http://localhost/api/agent", {
        body: JSON.stringify({ message: "hello", sessionId: "s1" }),
        headers: { "Content-Type": "application/json", "x-guest-id": "not-a-uuid" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/UUID v4/i);
  });
});

describe("createAgentRequestHandler — execution-request mapping", () => {
  it("maps the parsed request into a correctly-shaped ExecutionRequest", async () => {
    const { executor, calls } = fakeExecutor({
      events: [makeUiUpdate("ok"), { kind: "result", result: SUCCESS_RESULT }],
    });
    const handler = createAgentRequestHandler(executor);

    await handler(
      guestAgentRequest({
        includeSubagentActivity: true,
        message: "  hello world  ",
        sessionId: "  session-42  ",
      }),
    );

    expect(calls).toHaveLength(1);
    const request = calls[0]?.request;
    expect(request).toBeDefined();
    expect(request?.identity).toEqual({ tenantId: GUEST_TENANT_ID, userId: DEFAULT_GUEST_ID });
    expect(request?.sessionId).toBe("session-42");
    expect(request?.messages).toEqual([{ content: "hello world", role: "user" }]);
    expect(request?.options).toEqual({
      includeActivity: true,
      requireStructuredOutput: true,
    });
    expect(request?.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(request?.traceContext).toBeDefined();
  });

  it("defaults includeActivity to false when the flag is absent", async () => {
    const { executor, calls } = fakeExecutor({
      events: [{ kind: "result", result: SUCCESS_RESULT }],
    });
    const handler = createAgentRequestHandler(executor);

    await handler(guestAgentRequest({ message: "hi", sessionId: "s1" }));

    expect(calls[0]?.request.options.includeActivity).toBe(false);
  });
});

describe("createAgentRequestHandler — NDJSON response", () => {
  it("streams UI events as NDJSON with the correct content type", async () => {
    const { executor } = fakeExecutor({
      events: [
        makeUiUpdate("first"),
        makeUiUpdate("second"),
        { kind: "result", result: SUCCESS_RESULT },
      ],
    });
    const handler = createAgentRequestHandler(executor);

    const response = await handler(guestAgentRequest({ message: "hi", sessionId: "s1" }));

    expect(response.headers.get("Content-Type")).toBe("application/x-ndjson; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("no-cache, no-transform");

    await expect(readNdjson(response)).resolves.toEqual([
      { type: "message", text: "first" },
      { type: "message", text: "second" },
    ]);
  });

  it("filters out lifecycle and result events — only UI updates reach the wire", async () => {
    const events: ExecutionEvent[] = [
      { kind: "lifecycle", phase: "started" },
      makeUiUpdate("visible"),
      { kind: "lifecycle", phase: "completed" },
      { kind: "result", result: SUCCESS_RESULT },
    ];
    const { executor } = fakeExecutor({ events });
    const handler = createAgentRequestHandler(executor);

    const response = await handler(guestAgentRequest({ message: "hi", sessionId: "s1" }));

    await expect(readNdjson(response)).resolves.toEqual([{ type: "message", text: "visible" }]);
  });

  it("preserves event ordering from the executor stream", async () => {
    const { executor } = fakeExecutor({
      events: [
        makeUiUpdate("a"),
        makeUiUpdate("b"),
        makeUiUpdate("c"),
        { kind: "result", result: SUCCESS_RESULT },
      ],
    });
    const handler = createAgentRequestHandler(executor);

    const response = await handler(guestAgentRequest({ message: "hi", sessionId: "s1" }));

    const updates = (await readNdjson(response)) as Array<{ text: string }>;
    expect(updates.map((u) => u.text)).toEqual(["a", "b", "c"]);
  });

  it("emits an empty body when the executor produces only lifecycle/result events", async () => {
    const { executor } = fakeExecutor({
      events: [
        { kind: "lifecycle", phase: "started" },
        { kind: "result", result: SUCCESS_RESULT },
      ],
    });
    const handler = createAgentRequestHandler(executor);

    const response = await handler(guestAgentRequest({ message: "hi", sessionId: "s1" }));

    await expect(readNdjson(response)).resolves.toEqual([]);
  });
});

describe("createAgentRequestHandler — cancellation", () => {
  it("aborts the executor signal when the client disconnects", async () => {
    const queue = new ControlledEventQueue();
    let capturedSignal: AbortSignal | null = null;
    const executor: AgentExecutor = {
      async execute(_request, signal) {
        capturedSignal = signal;
        return { events: queue, result: Promise.resolve(SUCCESS_RESULT) };
      },
    };
    const handler = createAgentRequestHandler(executor);

    const response = await handler(guestAgentRequest({ message: "hi", sessionId: "s1" }));

    const signal = capturedSignal as AbortSignal | null;
    expect(signal?.aborted).toBe(false);
    if (!response.body) throw new Error("expected response body");
    const reader = response.body.getReader();
    queue.push(makeUiUpdate("partial"));
    await reader.read();

    reader.cancel();
    await flushMicrotasks();

    expect((capturedSignal as AbortSignal | null)?.aborted).toBe(true);
    queue.close();
  });
});

describe("createAgentRequestHandler — error mapping", () => {
  it("returns 409 with the active run id when the executor throws a session-busy error", async () => {
    const busy = makeSessionBusyError("active-run-123") as SessionBusyError;
    const { executor } = fakeExecutor({ throwOnExecute: busy });
    const handler = createAgentRequestHandler(executor);

    const response = await handler(guestAgentRequest({ message: "hi", sessionId: "s1" }));

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string; activeRunId: string };
    expect(body.error).toMatch(/busy/i);
    expect(body.activeRunId).toBe("active-run-123");
  });

  it("returns 500 for a generic executor error", async () => {
    const { executor } = fakeExecutor({ throwOnExecute: new Error("kaboom") });
    const handler = createAgentRequestHandler(executor);

    const response = await handler(guestAgentRequest({ message: "hi", sessionId: "s1" }));

    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("kaboom");
  });
});

// Minimal push/close async queue so the cancellation test can emit events on
// demand and observe the abort signal after client disconnect.
class ControlledEventQueue implements AsyncIterable<ExecutionEvent> {
  #closed = false;
  #queue: ExecutionEvent[] = [];
  #waiter: (() => void) | undefined;

  push(event: ExecutionEvent): void {
    if (this.#closed) return;
    this.#queue.push(event);
    this.#waiter?.();
    this.#waiter = undefined;
  }

  close(): void {
    this.#closed = true;
    this.#waiter?.();
    this.#waiter = undefined;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<ExecutionEvent> {
    while (true) {
      if (this.#queue.length > 0) {
        yield this.#queue.shift() as ExecutionEvent;
        continue;
      }
      if (this.#closed) return;
      await new Promise<void>((resolve) => {
        this.#waiter = resolve;
      });
    }
  }
}

async function flushMicrotasks(count = 5): Promise<void> {
  for (let i = 0; i < count; i++) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
}
