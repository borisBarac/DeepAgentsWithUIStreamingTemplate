import { Queue } from "bullmq";
import type { Redis } from "ioredis";
import type { AgentSource, AsyncEventQueue } from "../agent-runtime/turn-runner.ts";
import type {
  AgentExecutionHandle,
  AgentExecutor,
  ExecutionEvent,
  ExecutionRequest,
  ExecutionResult,
} from "../agent-runtime/types.ts";
import { RedisCancellation } from "../redis/cancellation.ts";
import { RedisEventStream, type RunEventEnvelope } from "../redis/event-stream.ts";
import { RedisRunStateStore } from "../redis/run-state.ts";
import { type AcquireResult, RedisSessionLock } from "../redis/session-lock.ts";
import { AGENT_TURN_QUEUE, bullMqQueuePrefix, encodeExecutionRequest } from "./serialization.ts";

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

// AgentExecutor that serializes an ExecutionRequest over BullMQ, acquires the
// per-session lock (returning a session-busy error on conflict), and projects
// AgentExecutionHandle over a Redis Stream. The worker process owns the actual
// agent turn; this class only:
//   1. INCR the fencing token + SET NX the session lock,
//   2. enqueue a BullMQ job carrying the fencing token (jobId=runId so
//      duplicate enqueue is a no-op),
//   3. XREAD the run's stream and yield events back to the runner.
// The HTTP route maps `session-busy` to HTTP 409 with the active runId.
export class BullMqAgentExecutor implements AgentExecutor {
  // Re-exported for diagnostics + tests.
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
    // 1. Acquire the session lock. Fail fast (→ 409) on conflict.
    const acquire = await this.lock.acquire(
      request.identity.tenantId,
      request.identity.userId,
      request.sessionId,
      request.runId,
    );
    if (!acquire.acquired) {
      throw makeSessionBusyError(acquire.holder.runId);
    }

    // 2-3. Record run as queued + enqueue. Both touch Redis/BullMQ and can
    // throw transiently; if they do we MUST release the lock we just won,
    // otherwise the session is wedged on the full lease (every retry → 409).
    try {
      await this.runState.recordQueued({
        identity: request.identity,
        runId: request.runId,
        sessionId: request.sessionId,
        startedAt: Date.now(),
        status: "queued",
      });

      // Enqueue. jobId=runId makes duplicate enqueues idempotent.
      // attempts: 1 disables BullMQ's automatic retry.
      // The fencing token travels in the envelope so the worker can validate
      // lock ownership before starting the turn.
      await this.queue.add(
        AGENT_TURN_QUEUE,
        encodeExecutionRequest(request, acquire.fencingToken),
        {
          attempts: 1,
          jobId: request.runId,
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

    // 4. Project the handle from the Redis stream. Cancellation: when the
    //    client disconnects, the runner aborts `signal` — the executor sets
    //    the cancellation flag so the worker can poll + abort the turn.
    const handle = this.#projectHandle(request, signal, acquire);
    return handle;
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

  async #readUntilTerminal(
    request: ExecutionRequest,
    signal: AbortSignal,
    queue: EventRelayQueue,
    acquire: Extract<AcquireResult, { acquired: true }>,
  ): Promise<ExecutionResult> {
    // Wire up cancellation propagation: when the runner aborts (client
    // disconnect), set the Redis cancellation flag.
    const onAbort = () => {
      void this.cancellation.cancel(request.runId);
    };
    signal.addEventListener("abort", onAbort, { once: true });

    try {
      let resolved: ExecutionResult | null = null;
      let afterId = "0";

      // Bounded read loop: after each XREAD batch, check lock ownership. If
      // the worker's lock has expired or been taken over by another run, the
      // terminal event may never arrive — synthesize an error result instead
      // of hanging indefinitely.
      while (resolved === null) {
        if (signal.aborted) break;

        const batch = await this.eventStream.read(request.runId, afterId, 1_000, 100);
        for (const entry of batch) {
          afterId = entry.id;
          const event = envelopeToEvent(entry.envelope);
          if (!event) continue;
          queue.push(event);
          if (event.kind === "result") {
            resolved = event.result;
            break;
          }
        }

        if (resolved !== null) break;

        // No terminal event yet — verify the worker still owns the lock. If
        // the lock expired or changed owner, the worker is gone (or about to
        // be aborted by its own lease refresher) and will not emit a terminal
        // event for this run. Relay a clear error, mark the run failed, and
        // close both the result promise and the event queue.
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
          // The lock changed hands — but the worker publishes its terminal
          // event BEFORE releasing the lock in its finally block. A 1s XREAD
          // can time out a few ms before that event lands, making a normal
          // completion look like a crash. Do one final short drain so a
          // completed/failed result is relayed instead of being masked by a
          // synthetic lease-lost error.
          const drain = await this.eventStream.read(request.runId, afterId, 250, 100);
          for (const entry of drain) {
            afterId = entry.id;
            const event = envelopeToEvent(entry.envelope);
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

      // Signal aborted without a terminal event. The worker usually publishes a
      // cancelled lifecycle followed by a terminal result as separate stream
      // entries shortly after the cancellation flag is set; a single XREAD may
      // return only the lifecycle. Loop short reads until a result lands or the
      // budget elapses, then fall back to run-state synthesis (mirrors the
      // lock-loss drain below, extended to coalesce the trailing result).
      if (resolved === null) {
        const deadline = Date.now() + 500;
        while (resolved === null && Date.now() < deadline) {
          const drain = await this.eventStream.read(request.runId, afterId, 250, 100);
          for (const entry of drain) {
            afterId = entry.id;
            const event = envelopeToEvent(entry.envelope);
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
    // Publish so any other reader of this run's stream also sees the error.
    await this.eventStream.publishError(request.runId, message).catch(() => undefined);
    await this.runState.recordFailed(request.runId, message).catch(() => undefined);
    queue.push({ kind: "ui", update: { message, type: "error" } });
    queue.push({ kind: "result", result });

    // Conditionally release only if the lock still carries our original
    // token. If someone else already re-acquired, release is a safe no-op
    // (the Lua script checks the token before deleting).
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
    const state = await this.runState.get(request.runId);
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
    queue.push({ kind: "result", result });

    // Defensive release in case the worker died before releasing.
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

// Translate a stream envelope into the internal ExecutionEvent shape. Returns
// null for envelopes that don't map to an event (e.g. result without a
// payload).
function envelopeToEvent(envelope: RunEventEnvelope): ExecutionEvent | null {
  if (envelope.kind === "lifecycle") {
    return { kind: "lifecycle", phase: envelope.phase ?? "completed" };
  }
  if (envelope.kind === "ui" && envelope.update) {
    return { kind: "ui", update: envelope.update };
  }
  if (envelope.kind === "result" && envelope.result) {
    return { kind: "result", result: envelope.result };
  }
  if (envelope.kind === "error" && envelope.message) {
    return { kind: "ui", update: { message: envelope.message, type: "error" } };
  }
  return null;
}

// Simple async-event queue used by the executor to bridge Redis Stream reads
// into the AgentExecutionHandle.events AsyncIterable contract. Re-uses the
// shape of turn-runner's AsyncEventQueue without leaking that type.
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

// Reserve for the future: an AgentSource is not needed at the executor (only
// at the worker). Re-exporting the type keeps the import shape stable.
export type { AgentSource, AsyncEventQueue };
