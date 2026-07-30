import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type {
  AgentExecutionHandle,
  ExecutionEvent,
  ExecutionRequest,
  ExecutionResult,
} from "../agent-runtime/types.ts";
import { RedisCancellation } from "../redis/cancellation.ts";
import { RedisEventStream } from "../redis/event-stream.ts";
import { FakeRedis } from "../redis/fake-redis.ts";
import { createRedisKeys } from "../redis/keys.ts";
import { RedisRunStateStore } from "../redis/run-state.ts";
import { RedisSessionLock } from "../redis/session-lock.ts";
import { BullMqAgentExecutor, isSessionBusyError } from "./bullmq-executor.ts";
import { AGENT_TURN_QUEUE, encodeExecutionRequest } from "./serialization.ts";

const IDENTITY = { tenantId: "tenant-a", userId: "user-1" };
const OTHER_IDENTITY = { tenantId: "tenant-a", userId: "user-2" };

const SUCCESS_RESULT: ExecutionResult = {
  outcome: "success",
  failure: null,
  history: [],
  structuredOutput: null,
  finalText: "",
};

// Minimal Queue stub: captures `add` calls so tests can inspect the enqueue
// payload and simulate the worker publishing events to the stream.
class FakeQueue {
  // Test seam: when set, `add` throws this error to simulate a BullMQ/Redis
  // failure at enqueue time.
  throwOnAdd: Error | null = null;
  readonly adds: {
    name: string;
    data: unknown;
    options: { attempts?: number; jobId?: string };
  }[] = [];
  async add(name: string, data: unknown, options?: unknown): Promise<{ id: string }> {
    if (this.throwOnAdd) throw this.throwOnAdd;
    const opts = (options ?? {}) as { attempts?: number; jobId?: string };
    this.adds.push({ data, name, options: opts });
    return { id: opts.jobId ?? `job-${this.adds.length}` };
  }
}

function buildRequest(overrides: Partial<ExecutionRequest> = {}): ExecutionRequest {
  return {
    identity: IDENTITY,
    messages: [{ content: "hi", role: "user" }],
    options: { includeActivity: false, requireStructuredOutput: true },
    runId: "00000000-0000-4000-8000-000000000001",
    sessionId: "session-1",
    traceContext: {},
    ...overrides,
  };
}

describe("BullMqAgentExecutor", () => {
  let client: FakeRedis;
  let queue: FakeQueue;
  let executor: BullMqAgentExecutor;
  let lock: RedisSessionLock;
  let eventStream: RedisEventStream;

  beforeEach(() => {
    client = new FakeRedis();
    queue = new FakeQueue();
    lock = new RedisSessionLock({ client: client.asRedis(), keyPrefix: "dat:" });
    const runState = new RedisRunStateStore({ client: client.asRedis(), keyPrefix: "dat:" });
    eventStream = new RedisEventStream({ client: client.asRedis(), keyPrefix: "dat:" });
    const cancellation = new RedisCancellation({
      client: client.asRedis(),
      keyPrefix: "dat:",
      pollIntervalMs: 5,
    });
    executor = new BullMqAgentExecutor({
      cancellation,
      eventStream,
      lock,
      queue: queue as unknown as ConstructorParameters<typeof BullMqAgentExecutor>[0]["queue"],
      runState,
    });
  });

  afterEach(() => {
    client._clear();
  });

  // Helper: publish a terminal result so the executor's stream reader resolves
  // and the handle does not leak across tests.
  async function terminate(
    handle: Promise<AgentExecutionHandle> | AgentExecutionHandle,
    runId: string,
  ): Promise<void> {
    const resolved = await handle;
    await eventStream.publishResult(IDENTITY, runId, SUCCESS_RESULT);
    await resolved.result;
  }

  it("throws a session-busy error when the lock is already held", async () => {
    // Pre-acquire the lock as another run.
    const held = await lock.acquire(IDENTITY.tenantId, IDENTITY.userId, "session-1", "other-run");
    expect(held.acquired).toBe(true);

    const request = buildRequest();
    let caught: unknown;
    try {
      await executor.execute(request, new AbortController().signal);
    } catch (error) {
      caught = error;
    }
    expect(isSessionBusyError(caught)).toBe(true);
    expect((caught as { activeRunId?: string }).activeRunId).toBe("other-run");
    // No job should have been enqueued.
    expect(queue.adds).toHaveLength(0);
  });

  it("enqueues with attempts=1 and an identity-scoped job id", async () => {
    const request = buildRequest({ runId: "fixed-run-id" });
    const handle = await executor.execute(request, new AbortController().signal);

    expect(queue.adds).toHaveLength(1);
    const add = queue.adds[0];
    if (!add) throw new Error("expected an enqueued job");
    expect(add.name).toBe(AGENT_TURN_QUEUE);
    expect(add.options.attempts).toBe(1);
    expect(add.options.jobId).not.toBe("fixed-run-id");
    expect(add.data).toEqual(encodeExecutionRequest(request, 1));

    await terminate(handle, request.runId);
  });

  it("records queued run state on a successful enqueue", async () => {
    const request = buildRequest();
    const handle = await executor.execute(request, new AbortController().signal);

    const state = await executor.runState.get(request.runId, request.identity);
    expect(state?.status).toBe("queued");
    expect(state?.identity).toEqual(IDENTITY);

    await terminate(handle, request.runId);
  });

  it("relays UI events from the stream to handle.events", async () => {
    const request = buildRequest();
    const handle = await executor.execute(request, new AbortController().signal);

    await eventStream.publishUi(request.identity, request.runId, {
      type: "message",
      text: "first",
    });
    await eventStream.publishUi(request.identity, request.runId, {
      type: "message",
      text: "second",
    });
    await eventStream.publishResult(request.identity, request.runId, SUCCESS_RESULT);

    const events = [];
    for await (const event of handle.events) {
      events.push(event);
    }
    const uiEvents = events
      .filter((e) => e.kind === "ui")
      .map((e) => (e.kind === "ui" ? e.update : null));
    expect(uiEvents).toEqual([
      { type: "message", text: "first" },
      { type: "message", text: "second" },
    ]);
    const result = await handle.result;
    expect(result.outcome).toBe("success");
  });

  it("sets the cancellation flag when the abort signal fires", async () => {
    const request = buildRequest();
    const controller = new AbortController();
    const handle = await executor.execute(request, controller.signal);

    controller.abort();
    await flushMicrotasks();
    expect(await executor.cancellation.isCancelled(request.identity, request.runId)).toBe(true);

    // Mark the run cancelled in Redis (as the worker would) before forcing a
    // terminal result so the synthesized outcome reflects the cancellation.
    await executor.runState.recordCancelled(request.runId, request.identity);
    await eventStream.publishResult(request.identity, request.runId, {
      outcome: "cancelled",
      failure: null,
      history: [],
      structuredOutput: null,
      finalText: "",
    });
    const result = await handle.result;
    // The synthesized outcome is derived from runState after the iterator
    // returns on abort. With state=cancelled we expect "cancelled".
    expect(result.outcome).toBe("cancelled");
  });

  it("requests cancellation once and reports terminal or unknown runs", async () => {
    const request = buildRequest();
    const handle = await executor.execute(request, new AbortController().signal);
    expect(await executor.cancel(request.identity, request.runId)).toEqual({ status: "requested" });
    expect(await executor.cancel(request.identity, request.runId)).toEqual({
      status: "already_requested",
    });
    await executor.runState.recordCancelled(request.runId, request.identity);
    expect(await executor.cancel(request.identity, request.runId)).toEqual({ status: "terminal" });
    expect(await executor.cancel(request.identity, "unknown-run")).toEqual({ status: "unknown" });
    await eventStream.publishResult(request.identity, request.runId, {
      outcome: "cancelled",
      failure: null,
      history: [],
      structuredOutput: null,
      finalText: "",
    });
    await handle.result;
  });

  it("does not let another guest cancel an identical run id", async () => {
    const request = buildRequest({ runId: "shared-run" });
    const handle = await executor.execute(request, new AbortController().signal);

    expect(await executor.cancel(OTHER_IDENTITY, request.runId)).toEqual({ status: "unknown" });
    expect(await executor.cancellation.isCancelled(request.identity, request.runId)).toBe(false);

    await terminate(handle, request.runId);
  });

  it("releases the lock when enqueue fails so the session is not wedged", async () => {
    // Simulate BullMQ rejecting the enqueue (Redis hiccup, etc.).
    queue.throwOnAdd = new Error("enqueue boom");
    const request = buildRequest();

    await expect(executor.execute(request, new AbortController().signal)).rejects.toThrow(
      "enqueue boom",
    );

    // The lock we won must be released, otherwise every retry returns 409
    // until the lease expires.
    expect(
      await lock.currentHolder(IDENTITY.tenantId, IDENTITY.userId, request.sessionId),
    ).toBeNull();

    // A fresh acquire (the retry path) succeeds immediately.
    const reacquire = await lock.acquire(
      IDENTITY.tenantId,
      IDENTITY.userId,
      request.sessionId,
      "retry-run",
    );
    expect(reacquire.acquired).toBe(true);
  });

  it("resolves with an error and closes events + result when the worker loses the lock without emitting a terminal event", async () => {
    const request = buildRequest();
    const handle = await executor.execute(request, new AbortController().signal);

    // Simulate the worker dying without ever publishing a terminal event: the
    // session lock is deleted (lease expiry) and then re-acquired by a new run
    // with a different fencing token.
    const lockKey = createRedisKeys("dat:").sessionLock(
      IDENTITY.tenantId,
      IDENTITY.userId,
      request.sessionId,
    );
    await client.del(lockKey);
    const takeover = await lock.acquire(
      IDENTITY.tenantId,
      IDENTITY.userId,
      request.sessionId,
      "takeover-run",
    );
    expect(takeover.acquired).toBe(true);

    // The executor's read loop should detect the lock loss, synthesize an
    // error result, and close BOTH handle.events and handle.result.
    const events: ExecutionEvent[] = [];
    for await (const event of handle.events) {
      events.push(event);
    }
    const result = await handle.result;

    expect(result.outcome).toBe("error");

    // An error UI update was relayed to the client.
    const errorEvents = events.filter((e) => e.kind === "ui" && e.update.type === "error");
    expect(errorEvents.length).toBeGreaterThan(0);

    // A terminal result event was emitted.
    expect(events.some((e) => e.kind === "result")).toBe(true);

    // Run state was marked failed.
    const state = await executor.runState.get(request.runId, request.identity);
    expect(state?.status).toBe("failed");

    // The takeover run still owns the lock (the executor did not release it).
    const holder = await lock.currentHolder(IDENTITY.tenantId, IDENTITY.userId, request.sessionId);
    expect(holder?.runId).toBe("takeover-run");
  });

  it("relays UI and the success result via the final drain when the worker releases the lock after publishing", async () => {
    const request = buildRequest();
    const handle = await executor.execute(request, new AbortController().signal);

    // Reproduce the race the final-drain safeguard protects: the worker
    // publishes its UI updates and terminal result, THEN releases the session
    // lock in its finally block. The executor's first blocking XREAD (already
    // in flight against an empty stream) times out empty, so the lock-ownership
    // check fails — but the final drain re-reads the stream and must relay the
    // published UI + success result instead of synthesizing "Session lease
    // lost".
    await eventStream.publishUi(request.identity, request.runId, {
      type: "message",
      text: "first",
    });
    await eventStream.publishUi(request.identity, request.runId, {
      type: "message",
      text: "second",
    });
    await eventStream.publishResult(request.identity, request.runId, SUCCESS_RESULT);

    const lockKey = createRedisKeys("dat:").sessionLock(
      IDENTITY.tenantId,
      IDENTITY.userId,
      request.sessionId,
    );
    await client.del(lockKey);

    const events: ExecutionEvent[] = [];
    for await (const event of handle.events) {
      events.push(event);
    }
    const result = await handle.result;

    // The genuine success result is relayed — not a synthetic error.
    expect(result.outcome).toBe("success");

    // Both UI updates reached the client, in order.
    const uiEvents = events
      .filter((e) => e.kind === "ui" && e.update.type !== "error")
      .map((e) => (e.kind === "ui" ? e.update : null));
    expect(uiEvents).toEqual([
      { type: "message", text: "first" },
      { type: "message", text: "second" },
    ]);

    // Crucially, no lease-lost error was injected.
    const leaseLost = events.some(
      (e) =>
        e.kind === "ui" && e.update.type === "error" && /lease lost/i.test(e.update.message ?? ""),
    );
    expect(leaseLost).toBe(false);
  });

  it("emits a visible UI error instead of a silent stream when the worker never responds", async () => {
    const request = buildRequest();
    const controller = new AbortController();
    const handle = await executor.execute(request, controller.signal);

    // Simulate the worker vanishing without ever publishing: abort the
    // request and leave no result on the stream. Drop run-state so the
    // synthesis fallback resolves to outcome "error".
    controller.abort();
    await flushMicrotasks();
    const runStateKey = createRedisKeys("dat:").runState(request.runId, request.identity);
    await client.del(runStateKey);

    const events: ExecutionEvent[] = [];
    for await (const event of handle.events) {
      events.push(event);
    }
    const result = await handle.result;

    // Outcome synthesized from missing run state is "error".
    expect(result.outcome).toBe("error");

    // A UI error update reached the client — the stream is not silent.
    const errorEvents = events.filter((e) => e.kind === "ui" && e.update.type === "error");
    expect(errorEvents).toHaveLength(1);
    const errorEvent = errorEvents[0];
    if (errorEvent?.kind === "ui" && errorEvent.update.type === "error") {
      expect(errorEvent.update.message).toBe("The agent did not produce a response.");
    }

    // A terminal result event still closes the stream.
    expect(events.some((e) => e.kind === "result")).toBe(true);
  });
});

async function flushMicrotasks(count = 5): Promise<void> {
  for (let i = 0; i < count; i++) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
}
