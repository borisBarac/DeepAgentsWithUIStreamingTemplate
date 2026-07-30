import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import type {
  AgentInputMessage,
  StreamableAgent,
  UiUpdate,
} from "@deep-agent-template/core/interaction-stream";
import { buildTurnMessages } from "../agent-runtime/messages.ts";
import { InMemorySessionStore } from "../agent-runtime/store.ts";
import { type AgentSource, TurnRunner } from "../agent-runtime/turn-runner.ts";
import type { ExecutionRequest, ExecutionResult, SessionStore } from "../agent-runtime/types.ts";
import { RedisCancellation } from "../redis/cancellation.ts";
import { RedisEventStream } from "../redis/event-stream.ts";
import { FakeRedis } from "../redis/fake-redis.ts";
import { createRedisKeys } from "../redis/keys.ts";
import { RedisRunStateStore } from "../redis/run-state.ts";
import { RedisSessionLock } from "../redis/session-lock.ts";
import { abortExpiredQueuedJob, runWorkerJob } from "./agent-worker.ts";

const IDENTITY = { tenantId: "tenant-a", userId: "user-1" };

function asyncIterableFrom<T>(items: T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}

// A minimal StreamableAgent that emits a known UI update and resolves the turn
// with the supplied result. Used to drive runWorkerJob without spinning up the
// real scaffolded agent.
function scriptedAgent(options: {
  ui?: UiUpdate[];
  outcome?: ExecutionResult["outcome"];
}): StreamableAgent {
  void options.outcome;
  return {
    async streamEvents() {
      return {
        messages: asyncIterableFrom([]),
        output: Promise.resolve({
          messages: [{ content: "ok", role: "assistant" }],
          structuredResponse: {
            updates: options.ui ?? [],
            version: 1,
          },
        }),
      };
    },
    async invoke() {
      return { messages: [] };
    },
  };
}

function scriptedAgentSource(agent: StreamableAgent): AgentSource {
  return () => agent;
}

function buildRequest(overrides: Partial<ExecutionRequest> = {}): ExecutionRequest {
  return {
    identity: IDENTITY,
    messages: [{ content: "hi", role: "user" }] as AgentInputMessage[],
    options: { includeActivity: false, requireStructuredOutput: true },
    runId: "00000000-0000-4000-8000-000000000001",
    sessionId: "session-1",
    traceContext: {},
    ...overrides,
  };
}

describe("runWorkerJob", () => {
  let client: FakeRedis;
  let lock: RedisSessionLock;
  let runState: RedisRunStateStore;
  let eventStream: RedisEventStream;
  let cancellation: RedisCancellation;
  let sessionStore: SessionStore;

  beforeEach(() => {
    client = new FakeRedis();
    lock = new RedisSessionLock({ client: client.asRedis(), keyPrefix: "dat:" });
    runState = new RedisRunStateStore({ client: client.asRedis(), keyPrefix: "dat:" });
    eventStream = new RedisEventStream({ client: client.asRedis(), keyPrefix: "dat:" });
    cancellation = new RedisCancellation({
      client: client.asRedis(),
      keyPrefix: "dat:",
      pollIntervalMs: 5,
    });
    sessionStore = new InMemorySessionStore();
  });

  afterEach(() => {
    client._clear();
  });

  async function acquireLock(request: ExecutionRequest) {
    await runState.recordQueued({
      identity: request.identity,
      runId: request.runId,
      sessionId: request.sessionId,
      startedAt: Date.now(),
      status: "queued",
    });
    const acquired = await lock.acquire(
      request.identity.tenantId,
      request.identity.userId,
      request.sessionId,
      request.runId,
    );
    if (!acquired.acquired) throw new Error("lock acquire failed in test setup");
    return acquired.fencingToken;
  }

  it("aborts an over-age queued job before it starts and releases its lock", async () => {
    const request = buildRequest();
    const fencingToken = await acquireLock(request);

    const result = await abortExpiredQueuedJob({
      eventStream,
      fencingToken,
      lock,
      request,
      runState,
    });

    expect(result.outcome).toBe("error");
    const events = await eventStream.read(request.runId, "0", 0, 50);
    expect(events.some((event) => event.envelope.kind === "error")).toBe(true);
    expect(events.some((event) => event.envelope.kind === "result")).toBe(true);
    expect(events.some((event) => event.envelope.kind === "lifecycle")).toBe(false);
    expect((await runState.get(request.runId))?.status).toBe("failed");
    expect(
      await lock.currentHolder(
        request.identity.tenantId,
        request.identity.userId,
        request.sessionId,
      ),
    ).toBeNull();
  });

  it("publishes UI events to the stream and commits the session on success", async () => {
    const agent = scriptedAgent({
      ui: [{ type: "message", text: "hello" }],
      outcome: "success",
    });
    const turnRunner = new TurnRunner({ agentSource: scriptedAgentSource(agent) });
    const request = buildRequest();
    const fencingToken = await acquireLock(request);

    const result = await runWorkerJob({
      cancellation,
      eventStream,
      lock,
      request,
      fencingToken,
      runState,
      sessionStore,
      turnRunner,
    });

    expect(result.outcome).toBe("success");
    // The session was committed.
    const loaded = await sessionStore.loadSession(request.identity, request.sessionId);
    expect(loaded.record).not.toBeNull();
    expect(loaded.version).toBeGreaterThan(0);

    // The UI event reached the stream.
    const events = await eventStream.read(request.runId, "0", 0, 50);
    const kinds = events.map((e) => e.envelope.kind);
    expect(kinds).toContain("ui");
    expect(kinds).toContain("result");

    // Run state was recorded as completed.
    const state = await runState.get(request.runId);
    expect(state?.status).toBe("completed");

    // Lock was released.
    expect(
      await lock.currentHolder(
        request.identity.tenantId,
        request.identity.userId,
        request.sessionId,
      ),
    ).toBeNull();
  });

  it("preserves prior session state and records cancelled on client disconnect", async () => {
    const sessionStore = new InMemorySessionStore();
    await sessionStore.commitSession(
      IDENTITY,
      "session-1",
      {
        failure: null,
        history: [{ content: "prior", role: "user" }],
        structuredOutput: null,
      },
      0,
    );

    // Agent that never emits a result; cancellation flag flips immediately.
    const hangingAgent: StreamableAgent = {
      async streamEvents() {
        return {
          messages: asyncIterableFrom([]),
          // Never-resolving output → turn hangs until we abort.
          output: new Promise<{ messages: never[]; structuredResponse: unknown }>(() => undefined),
        };
      },
      async invoke() {
        return { messages: [] };
      },
    };
    const turnRunner = new TurnRunner({ agentSource: scriptedAgentSource(hangingAgent) });
    const request = buildRequest();
    const fencingToken = await acquireLock(request);

    // Cancel after the run starts.
    setTimeout(() => void cancellation.cancel(request.runId), 5);

    const result = await runWorkerJob({
      cancellation,
      eventStream,
      lock,
      request,
      fencingToken,
      runState,
      sessionStore,
      turnRunner,
    });

    expect(result.outcome).toBe("cancelled");
    // Prior state preserved (cancel never overwrites the history).
    const loaded = await sessionStore.loadSession(IDENTITY, "session-1");
    expect(loaded.record?.history).toEqual([{ content: "prior", role: "user" }]);

    // Run state recorded as cancelled.
    const state = await runState.get(request.runId);
    expect(state?.status).toBe("cancelled");
  });

  it("does not commit and records failed when the agent source throws", async () => {
    const sessionStore = new InMemorySessionStore();
    await sessionStore.commitSession(
      IDENTITY,
      "session-1",
      {
        failure: null,
        history: [{ content: "prior", role: "user" }],
        structuredOutput: null,
      },
      0,
    );
    const turnRunner = new TurnRunner({
      agentSource: async () => {
        throw new Error("agent source failed");
      },
    });
    const request = buildRequest();
    const fencingToken = await acquireLock(request);

    const result = await runWorkerJob({
      cancellation,
      eventStream,
      lock,
      request,
      fencingToken,
      runState,
      sessionStore,
      turnRunner,
    });

    expect(result.outcome).toBe("error");
    const loaded = await sessionStore.loadSession(IDENTITY, "session-1");
    // Prior state preserved (error never overwrites the history).
    expect(loaded.record?.history).toEqual([{ content: "prior", role: "user" }]);
    // Run state recorded as failed.
    const state = await runState.get(request.runId);
    expect(state?.status).toBe("failed");
    // Error surfaces to the client as a UI error update (the TurnRunner
    // translates thrown agent-source errors into a UI error event rather than
    // a stream-level error envelope).
    const events = await eventStream.read(request.runId, "0", 0, 50);
    const errorUis = events.filter(
      (e) =>
        e.envelope.kind === "ui" &&
        e.envelope.update?.type === "error" &&
        typeof e.envelope.update?.message === "string" &&
        e.envelope.update.message.includes("agent source failed"),
    );
    expect(errorUis.length).toBeGreaterThan(0);
  });

  it("releases the lock and trims the stream in its finally block", async () => {
    const agent = scriptedAgent({ ui: [{ type: "message", text: "hi" }] });
    const turnRunner = new TurnRunner({ agentSource: scriptedAgentSource(agent) });
    const request = buildRequest();
    const fencingToken = await acquireLock(request);

    await runWorkerJob({
      cancellation,
      eventStream,
      lock,
      request,
      fencingToken,
      runState,
      sessionStore,
      turnRunner,
    });

    expect(
      await lock.currentHolder(
        request.identity.tenantId,
        request.identity.userId,
        request.sessionId,
      ),
    ).toBeNull();
  });

  it("aborts the turn and surfaces a stream error when the lease is lost mid-run", async () => {
    // Agent that never resolves its turn — the run hangs until the lease-loss
    // callback aborts it.
    const hangingAgent: StreamableAgent = {
      async streamEvents() {
        return {
          messages: asyncIterableFrom([]),
          output: new Promise<{ messages: never[]; structuredResponse: unknown }>(() => undefined),
        };
      },
      async invoke() {
        return { messages: [] };
      },
    };
    const turnRunner = new TurnRunner({ agentSource: scriptedAgentSource(hangingAgent) });
    const request = buildRequest();
    const fencingToken = await acquireLock(request);

    // Simulate lease expiry/takeover: delete the lock key shortly after the
    // run starts so the next refresh tick finds no holder and returns false.
    const lockKey = createRedisKeys("dat:").sessionLock(
      IDENTITY.tenantId,
      IDENTITY.userId,
      request.sessionId,
    );
    setTimeout(() => void client.del(lockKey), 3);

    const result = await runWorkerJob({
      cancellation,
      eventStream,
      lock,
      request,
      fencingToken,
      runState,
      sessionStore,
      turnRunner,
      lockRefreshMs: 5,
    });

    // The turn was aborted and finalized as cancelled (not committed).
    expect(result.outcome).toBe("cancelled");
    const loaded = await sessionStore.loadSession(IDENTITY, request.sessionId);
    expect(loaded.record).toBeNull();

    // A stream error was published.
    const events = await eventStream.read(request.runId, "0", 0, 50);
    expect(events.some((e) => e.envelope.kind === "error")).toBe(true);

    // Run state recorded as cancelled.
    const state = await runState.get(request.runId);
    expect(state?.status).toBe("cancelled");
  });

  it("rebuilds messages from fresh history: stored history, transient context, then new user message", async () => {
    // Pre-populate the session store with prior history.
    await sessionStore.commitSession(
      IDENTITY,
      "session-1",
      {
        failure: null,
        history: [
          { content: "prior-question", role: "user" },
          { content: "prior-answer", role: "assistant" },
        ],
        structuredOutput: null,
      },
      0,
    );

    // Recording agent: captures the messages it receives.
    const recordedMessages: AgentInputMessage[][] = [];
    const recordingAgent: StreamableAgent = {
      async streamEvents(input) {
        recordedMessages.push(input.messages);
        return {
          messages: asyncIterableFrom([]),
          output: Promise.resolve({
            messages: [{ content: "new-answer", role: "assistant" }],
            structuredResponse: {
              updates: [{ type: "message", text: "reply" }],
              version: 1,
            },
          }),
        };
      },
      async invoke() {
        return { messages: [] };
      },
    };
    const turnRunner = new TurnRunner({ agentSource: scriptedAgentSource(recordingAgent) });

    // The request's messages were built by the API from STALE history (empty
    // at enqueue time). The worker must rebuild from the FRESH session store.
    const userMessage = "latest-user-msg";
    const request = buildRequest({
      messages: buildTurnMessages([], userMessage),
    });
    const fencingToken = await acquireLock(request);

    const result = await runWorkerJob({
      cancellation,
      eventStream,
      lock,
      request,
      fencingToken,
      runState,
      sessionStore,
      turnRunner,
    });

    expect(result.outcome).toBe("success");

    // The agent received: fresh history, transient context, then the new user
    // message — in that exact order.
    const seen = recordedMessages[0] ?? [];
    const contents = seen.map((m) => m.content);
    expect(contents[0]).toBe("prior-question");
    expect(contents[1]).toBe("prior-answer");
    // Transient context message is present (marked with additional_kwargs).
    const transient = seen.find((m) => m.additional_kwargs?.transient_context);
    expect(transient).toBeDefined();
    expect(typeof transient?.content).toBe("string");
    // New user message comes after the transient context.
    const transientIdx = seen.findIndex((m) => m.additional_kwargs?.transient_context);
    expect(seen[transientIdx + 1]?.content).toBe(userMessage);

    // Successful output EXTENDS the stored history rather than replacing it.
    const loaded = await sessionStore.loadSession(IDENTITY, request.sessionId);
    const storedContents = (loaded.record?.history ?? []).map(
      (m: unknown) => (m as { content?: unknown }).content,
    );
    expect(storedContents).toContain("prior-question");
    expect(storedContents).toContain("prior-answer");
    expect(storedContents).toContain(userMessage);
  });

  it("rejects a stale job when the fencing token or runId differs", async () => {
    const agent = scriptedAgent({ ui: [{ type: "message", text: "hello" }] });
    const turnRunner = new TurnRunner({ agentSource: scriptedAgentSource(agent) });

    // Original run acquires the lock, then a NEW run takes over.
    const originalRequest = buildRequest({ runId: "original-run" });
    const originalToken = await acquireLock(originalRequest);
    // Release and re-acquire as a different run.
    await lock.release(IDENTITY.tenantId, IDENTITY.userId, "session-1", originalToken);
    const newAcquired = await lock.acquire(
      IDENTITY.tenantId,
      IDENTITY.userId,
      "session-1",
      "new-run",
    );
    if (!newAcquired.acquired) throw new Error("setup: re-acquire failed");

    // Now the original job runs with its old fencing token — it must be
    // rejected because the lock now belongs to "new-run".
    const result = await runWorkerJob({
      cancellation,
      eventStream,
      lock,
      request: originalRequest,
      fencingToken: originalToken,
      runState,
      sessionStore,
      turnRunner,
    });

    expect(result.outcome).toBe("error");

    // The turn never ran: the scripted agent was not invoked (no UI events
    // from it in the stream, only the worker's error + result).
    const events = await eventStream.read(originalRequest.runId, "0", 0, 50);
    expect(events.some((e) => e.envelope.kind === "error")).toBe(true);
    expect(events.some((e) => e.envelope.kind === "result")).toBe(true);
    // No UI events from the agent (it would have published {type:"message"}).
    expect(events.some((e) => e.envelope.kind === "ui")).toBe(false);

    // Run state recorded as failed.
    const state = await runState.get(originalRequest.runId);
    expect(state?.status).toBe("failed");

    // The NEW owner's lock is untouched — the stale job did NOT release or
    // refresh it.
    const holder = await lock.currentHolder(IDENTITY.tenantId, IDENTITY.userId, "session-1");
    expect(holder?.runId).toBe("new-run");
  });
});
