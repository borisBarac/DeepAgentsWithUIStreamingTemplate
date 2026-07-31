import { afterAll, beforeEach, describe, expect, it } from "bun:test";

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
import { createAgentReattachHandler } from "./reattach/route.ts";
import { createAgentRequestHandler } from "./route.ts";

const SUCCESS_RESULT: ExecutionResult = {
  outcome: "success",
  failure: null,
  history: [],
  structuredOutput: null,
  finalText: "",
};

const previousGuestSecret = process.env.GUEST_IDENTITY_SECRET;

beforeEach(() => {
  process.env.GUEST_IDENTITY_SECRET = "route-test-secret";
});

afterAll(() => {
  if (previousGuestSecret === undefined) delete process.env.GUEST_IDENTITY_SECRET;
  else process.env.GUEST_IDENTITY_SECRET = previousGuestSecret;
});

function fakeExecutor(
  events: ExecutionEvent[],
  onExecute?: (request: ExecutionRequest) => void,
): AgentExecutor {
  const result: ExecutionResult =
    events.find((e) => e.kind === "result")?.kind === "result"
      ? (events.find((e) => e.kind === "result") as { result: ExecutionResult }).result
      : SUCCESS_RESULT;

  return {
    execute(_request: ExecutionRequest, _signal: AbortSignal): Promise<AgentExecutionHandle> {
      onExecute?.(_request);
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
    reattach() {
      return null;
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
    reattach() {
      return null;
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

  it("sets, reuses, and replaces the signed guest cookie", async () => {
    const identities: string[] = [];
    const handler = createAgentRequestHandler(
      fakeExecutor([], (request) => identities.push(request.identity.userId)),
    );
    const init = {
      body: JSON.stringify({
        message: "hi",
        runId: "r1",
        sessionId: "same",
        tenantId: "attacker",
        userId: "attacker",
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    } as const;
    const first = await handler(new Request("http://localhost/api/agent", init));
    await first.text();
    const cookie = first.headers.get("Set-Cookie");
    expect(cookie).toContain("guest_identity=");
    expect(cookie).toContain("HttpOnly");
    const cookieValue = cookie?.split(";")[0];
    if (!cookieValue) throw new Error("expected guest cookie");

    const second = await handler(
      new Request("http://localhost/api/agent", {
        ...init,
        headers: { ...init.headers, cookie: cookieValue },
      }),
    );
    await second.text();
    expect(second.headers.get("Set-Cookie")).toBeNull();
    expect(identities[1]).toBe(identities[0]);
    expect(identities[0]).not.toBe("attacker");

    const tampered = `${cookieValue.slice(0, -1)}${cookieValue.endsWith("a") ? "b" : "a"}`;
    const third = await handler(
      new Request("http://localhost/api/agent", {
        ...init,
        headers: { ...init.headers, cookie: tampered },
      }),
    );
    await third.text();
    expect(third.headers.get("Set-Cookie")).toContain("guest_identity=");
    expect(identities[2]).not.toBe(identities[0]);
  });

  it("streams UI updates with their Redis cursors and hides lifecycle/result events", async () => {
    const events: ExecutionEvent[] = [
      { kind: "lifecycle", phase: "started" },
      { eventId: "1-0", kind: "ui", update: { type: "message", text: "hello" } },
      { eventId: "2-0", kind: "ui", update: { type: "message", text: "world" } },
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
    expect(updates[0]).toEqual({ eventId: "1-0", update: { type: "message", text: "hello" } });
    expect(updates[1]).toEqual({ eventId: "2-0", update: { type: "message", text: "world" } });
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
      reattach() {
        return null;
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

  it("does not abort the executor when response delivery is cancelled", async () => {
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
    expect(aborted).toBe(false);
  });

  it("does not abort the executor from request.signal", async () => {
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
    expect(aborted).toBe(false);
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
      let identity: ExecutionRequest["identity"] | undefined;
      const executor: AgentExecutor = {
        async cancel(receivedIdentity) {
          identity = receivedIdentity;
          return result;
        },
        async execute() {
          throw new Error("unused");
        },
        reattach() {
          return null;
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
      expect(identity).toEqual({ tenantId: "guest", userId: expect.any(String) });
    });
  }
});

describe("createAgentReattachHandler", () => {
  it("streams reattached UI events and forwards the guest identity and cursor", async () => {
    let received: unknown[] = [];
    const executor = fakeExecutor([]);
    executor.reattach = async (identity, sessionId, runId, afterEventId) => {
      received = [identity, sessionId, runId, afterEventId];
      return {
        events: {
          async *[Symbol.asyncIterator]() {
            yield {
              eventId: "124-0",
              kind: "ui",
              update: { text: "missed", type: "message" },
            } as const;
            yield { kind: "result", result: SUCCESS_RESULT } as const;
          },
        },
        result: Promise.resolve(SUCCESS_RESULT),
      };
    };
    const response = await createAgentReattachHandler(executor)(
      new Request("http://localhost/api/agent/reattach", {
        body: JSON.stringify({ afterEventId: "123-0", runId: "r1", sessionId: "s1" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(200);
    expect(await readNdjson(response)).toEqual([
      { eventId: "124-0", update: { text: "missed", type: "message" } },
    ]);
    expect(received).toEqual([
      { tenantId: "guest", userId: expect.any(String) },
      "s1",
      "r1",
      "123-0",
    ]);
  });

  it("returns 404 when the run is unavailable to this guest/session", async () => {
    const response = await createAgentReattachHandler(fakeExecutor([]))(
      new Request("http://localhost/api/agent/reattach", {
        body: JSON.stringify({ afterEventId: "0", runId: "r1", sessionId: "s1" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    expect(response.status).toBe(404);
  });
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
