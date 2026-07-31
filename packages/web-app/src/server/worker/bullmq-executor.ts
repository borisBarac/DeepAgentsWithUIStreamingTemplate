import { Queue } from "bullmq";
import type { Redis } from "ioredis";
import type { AgentSource, AsyncEventQueue } from "../agent-runtime/turn-runner.ts";
import type {
  AgentExecutionHandle,
  AgentExecutor,
  CancellationResult,
  ExecutionEvent,
  ExecutionRequest,
  ExecutionResult,
} from "../agent-runtime/types.ts";
import { RedisCancellation } from "../redis/cancellation.ts";
import { RedisEventStream, type RunEventEnvelope } from "../redis/event-stream.ts";
import { RedisRunStateStore } from "../redis/run-state.ts";
import { type AcquireResult, RedisSessionLock } from "../redis/session-lock.ts";
import {
  AGENT_TURN_QUEUE,
  bullMqQueuePrefix,
  encodeExecutionRequest,
  scopedJobId,
} from "./serialization.ts";

export type SessionBusyError = Error & { activeRunId: string; code: "session_busy" };

export function makeSessionBusyError(activeRunId: string): SessionBusyError {
  const error = new Error(
    `Session is busy: another run ${activeRunId} is already in progress.`,
  ) as SessionBusyError;
  error.activeRunId = activeRunId;
  error.code = "session_busy";
  error.name = "SessionBusyError";
  return error;
}

export function isSessionBusyError(value: unknown): value is SessionBusyError {
  return value instanceof Error && (value as { code?: unknown }).code === "session_busy";
}

export type BullMqAgentExecutorOptions = {
  readonly queue: Queue;
  readonly lock: RedisSessionLock;
  readonly runState: RedisRunStateStore;
  readonly eventStream: RedisEventStream;
  readonly cancellation: RedisCancellation;
};

export class BullMqAgentExecutor implements AgentExecutor {
  readonly lock: RedisSessionLock;
  readonly runState: RedisRunStateStore;
  readonly eventStream: RedisEventStream;
  readonly cancellation: RedisCancellation;
  readonly queue: Queue;

  constructor(options: BullMqAgentExecutorOptions) {
    this.lock = options.lock;
    this.runState = options.runState;
    this.eventStream = options.eventStream;
    this.cancellation = options.cancellation;
    this.queue = options.queue;
  }

  async execute(request: ExecutionRequest, signal: AbortSignal): Promise<AgentExecutionHandle> {
    const acquire = await this.lock.acquire(
      request.identity.tenantId,
      request.identity.userId,
      request.sessionId,
      request.runId,
    );
    if (!acquire.acquired) {
      throw makeSessionBusyError(acquire.holder.runId);
    }

    try {
      await this.runState.recordQueued({
        identity: request.identity,
        runId: request.runId,
        sessionId: request.sessionId,
        startedAt: Date.now(),
        status: "queued",
      });

      await this.queue.add(
        AGENT_TURN_QUEUE,
        encodeExecutionRequest(request, acquire.fencingToken),
        {
          attempts: 1,
          jobId: scopedJobId(request.identity, request.runId),
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    } catch (error) {
      await this.lock
        .release(
          request.identity.tenantId,
          request.identity.userId,
          request.sessionId,
          acquire.fencingToken,
        )
        .catch(() => undefined);
      throw error;
    }

    const handle = this.#projectHandle(request, signal, acquire);
    return handle;
  }

  async cancel(identity: ExecutionRequest["identity"], runId: string): Promise<CancellationResult> {
    const state = await this.runState.get(runId, identity);
    if (!state) return { status: "unknown" };
    if (state.status === "completed" || state.status === "failed" || state.status === "cancelled") {
      return { status: "terminal" };
    }
    if (await this.cancellation.isCancelled(identity, runId))
      return { status: "already_requested" };
    await this.cancellation.cancel(identity, runId);
    return { status: "requested" };
  }

  async reattach(
    identity: ExecutionRequest["identity"],
    sessionId: string,
    runId: string,
    afterEventId: string,
  ): Promise<AgentExecutionHandle | null> {
    const state = await this.runState.get(runId, identity);
    if (!state || state.sessionId !== sessionId) return null;

    const queue = new EventRelayQueue();
    const result = this.#readReattached(identity, runId, afterEventId, queue);
    return { events: queue, result };
  }

  #projectHandle(
    request: ExecutionRequest,
    signal: AbortSignal,
    acquire: Extract<AcquireResult, { acquired: true }>,
  ): AgentExecutionHandle {
    const queue = new EventRelayQueue();
    const result = this.#readUntilTerminal(request, signal, queue, acquire);
    return { events: queue, result };
  }

  async #readReattached(
    identity: ExecutionRequest["identity"],
    runId: string,
    initialAfterId: string,
    queue: EventRelayQueue,
  ): Promise<ExecutionResult> {
    let afterId = initialAfterId;
    try {
      while (true) {
        const batch = await this.eventStream.read(identity, runId, afterId, 1_000, 100);
        for (const entry of batch) {
          afterId = entry.id;
          const event = envelopeToEvent(entry.id, entry.envelope);
          if (!event) continue;
          queue.push(event);
          if (event.kind === "result") return event.result;
        }

        const state = await this.runState.get(runId, identity);
        if (
          !state ||
          state.status === "completed" ||
          state.status === "failed" ||
          state.status === "cancelled"
        ) {
          return terminalResultFromState(state?.status);
        }
      }
    } finally {
      queue.close();
    }
  }

  async #readUntilTerminal(
    request: ExecutionRequest,
    signal: AbortSignal,
    queue: EventRelayQueue,
    acquire: Extract<AcquireResult, { acquired: true }>,
  ): Promise<ExecutionResult> {
    const onAbort = () => {
      void this.cancellation.cancel(request.identity, request.runId);
    };
    signal.addEventListener("abort", onAbort, { once: true });

    try {
      let resolved: ExecutionResult | null = null;
      let afterId = "0";

      while (resolved === null) {
        if (signal.aborted) break;

        const batch = await this.eventStream.read(
          request.identity,
          request.runId,
          afterId,
          1_000,
          100,
        );
        for (const entry of batch) {
          afterId = entry.id;
          const event = envelopeToEvent(entry.id, entry.envelope);
          if (!event) continue;
          queue.push(event);
          if (event.kind === "result") {
            resolved = event.result;
            break;
          }
        }

        if (resolved !== null) break;

        const holder = await this.lock.currentHolder(
          request.identity.tenantId,
          request.identity.userId,
          request.sessionId,
        );
        const stillOurs =
          holder !== null &&
          holder.runId === request.runId &&
          holder.fencingToken === acquire.fencingToken;

        if (!stillOurs) {
          const drain = await this.eventStream.read(
            request.identity,
            request.runId,
            afterId,
            250,
            100,
          );
          for (const entry of drain) {
            afterId = entry.id;
            const event = envelopeToEvent(entry.id, entry.envelope);
            if (!event) continue;
            queue.push(event);
            if (event.kind === "result") {
              resolved = event.result;
              break;
            }
          }
          if (resolved === null) {
            resolved = await this.#handleLockLoss(request, queue, acquire);
          }
          break;
        }
      }

      if (resolved === null) {
        const deadline = Date.now() + 500;
        while (resolved === null && Date.now() < deadline) {
          const drain = await this.eventStream.read(
            request.identity,
            request.runId,
            afterId,
            250,
            100,
          );
          for (const entry of drain) {
            afterId = entry.id;
            const event = envelopeToEvent(entry.id, entry.envelope);
            if (!event) continue;
            queue.push(event);
            if (event.kind === "result") {
              resolved = event.result;
              break;
            }
          }
        }
      }

      if (resolved === null) {
        resolved = await this.#synthesizeFromRunState(request, queue, acquire);
      }

      return resolved;
    } finally {
      signal.removeEventListener("abort", onAbort);
      queue.close();
    }
  }

  async #handleLockLoss(
    request: ExecutionRequest,
    queue: EventRelayQueue,
    acquire: Extract<AcquireResult, { acquired: true }>,
  ): Promise<ExecutionResult> {
    const message =
      "Session lease lost; the worker stopped responding and another run may have taken over.";
    const result: ExecutionResult = {
      outcome: "error",
      failure: null,
      history: [],
      structuredOutput: null,
      finalText: "",
    };
    await this.eventStream
      .publishError(request.identity, request.runId, message)
      .catch(() => undefined);
    await this.runState
      .recordFailed(request.runId, message, request.identity)
      .catch(() => undefined);
    queue.push({ kind: "ui", update: { message, type: "error" } });
    queue.push({ kind: "result", result });

    await this.lock
      .release(
        request.identity.tenantId,
        request.identity.userId,
        request.sessionId,
        acquire.fencingToken,
      )
      .catch(() => undefined);

    return result;
  }

  async #synthesizeFromRunState(
    request: ExecutionRequest,
    queue: EventRelayQueue,
    acquire: Extract<AcquireResult, { acquired: true }>,
  ): Promise<ExecutionResult> {
    const state = await this.runState.get(request.runId, request.identity);
    const status = state?.status ?? "failed";
    const outcome =
      status === "cancelled" ? "cancelled" : status === "completed" ? "success" : "error";
    const result: ExecutionResult = {
      outcome,
      failure: null,
      history: [],
      structuredOutput: null,
      finalText: "",
    };
    if (outcome === "error") {
      queue.push({
        kind: "ui",
        update: { message: "The agent did not produce a response.", type: "error" },
      });
    } else if (outcome === "cancelled") {
      queue.push({ kind: "ui", update: { text: "Cancelled.", type: "message" } });
    }
    queue.push({ kind: "result", result });

    await this.lock
      .release(
        request.identity.tenantId,
        request.identity.userId,
        request.sessionId,
        acquire.fencingToken,
      )
      .catch(() => undefined);

    return result;
  }
}

function terminalResultFromState(status: string | undefined): ExecutionResult {
  return {
    outcome: status === "cancelled" ? "cancelled" : status === "completed" ? "success" : "error",
    failure: null,
    history: [],
    structuredOutput: null,
    finalText: "",
  };
}

function envelopeToEvent(eventId: string, envelope: RunEventEnvelope): ExecutionEvent | null {
  if (envelope.kind === "lifecycle") {
    return { kind: "lifecycle", phase: envelope.phase ?? "completed" };
  }
  if (envelope.kind === "ui" && envelope.update) {
    return { kind: "ui", update: envelope.update, eventId };
  }
  if (envelope.kind === "result" && envelope.result) {
    return { kind: "result", result: envelope.result };
  }
  if (envelope.kind === "error" && envelope.message) {
    return { kind: "ui", update: { message: envelope.message, type: "error" }, eventId };
  }
  return null;
}

class EventRelayQueue implements AsyncIterable<ExecutionEvent> {
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

export function buildBullMqAgentExecutor(options: {
  bullMqClient: Redis;
  client: Redis;
  keyPrefix: string;
}): BullMqAgentExecutor {
  const queue = new Queue(AGENT_TURN_QUEUE, {
    connection: options.bullMqClient,
    prefix: bullMqQueuePrefix(options.keyPrefix),
  });
  const lock = new RedisSessionLock({ client: options.client, keyPrefix: options.keyPrefix });
  const runState = new RedisRunStateStore({ client: options.client, keyPrefix: options.keyPrefix });
  const eventStream = new RedisEventStream({
    client: options.client,
    keyPrefix: options.keyPrefix,
  });
  const cancellation = new RedisCancellation({
    client: options.client,
    keyPrefix: options.keyPrefix,
  });
  return new BullMqAgentExecutor({
    cancellation,
    eventStream,
    lock,
    queue,
    runState,
  });
}

export type { AgentSource, AsyncEventQueue };
