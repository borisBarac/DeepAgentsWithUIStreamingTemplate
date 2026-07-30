import type { AgentInputMessage } from "@deep-agent-template/core/interaction-stream";
import { Worker } from "bullmq";

import {
  createAgentForIdentity,
  disposeLinkloomConnection,
  disposeSandboxConnection,
} from "../agent-provider.ts";
import { buildTurnMessages } from "../agent-runtime/messages.ts";
import {
  context,
  extractTraceContext,
  getTracer,
  type Span,
  setIdentityAttributes,
  trace,
} from "../agent-runtime/telemetry.ts";
import { type AgentSource, TurnRunner } from "../agent-runtime/turn-runner.ts";
import type {
  ExecutionEvent,
  ExecutionIdentity,
  ExecutionRequest,
  ExecutionResult,
  SessionStore,
} from "../agent-runtime/types.ts";
import { RedisCancellation } from "../redis/cancellation.ts";
import {
  getBullMqRedis,
  getSharedRedis,
  isRedisConfigured,
  resolveRedisOptions,
} from "../redis/client.ts";
import { RedisEventStream } from "../redis/event-stream.ts";
import { RedisSessionStore } from "../redis/redis-session-store.ts";
import { RedisRunStateStore } from "../redis/run-state.ts";
import { RedisSessionLock } from "../redis/session-lock.ts";
import { AGENT_TURN_QUEUE, bullMqQueuePrefix, decodeExecutionRequest } from "./serialization.ts";

export type WorkerServices = {
  readonly worker: Worker;
  readonly lock: RedisSessionLock;
  readonly runState: RedisRunStateStore;
  readonly eventStream: RedisEventStream;
  readonly cancellation: RedisCancellation;
  readonly sessionStore: SessionStore;
  readonly close: () => Promise<void>;
};

export type CreateWorkerOptions = {
  readonly concurrency?: number;
  readonly lockRefreshMs?: number;
  readonly cancellationPollMs?: number;
  readonly maxQueueWaitMs?: number;
  readonly agentSource?: AgentSource;
};

export const DEFAULT_MAX_QUEUE_WAIT_MS = 60_000;
const QUEUE_WAIT_EXCEEDED_MESSAGE =
  "Agent job waited in the queue for more than one minute. Aborting before the turn starts.";

export async function createAgentWorker(
  options: CreateWorkerOptions = {},
): Promise<WorkerServices> {
  if (!isRedisConfigured()) {
    throw new Error("Agent worker requires REDIS_URL.");
  }
  const { keyPrefix } = resolveRedisOptions();
  const client = await getSharedRedis();
  const bullMqClient = await getBullMqRedis();

  const lock = new RedisSessionLock({ client, keyPrefix });
  const runState = new RedisRunStateStore({ client, keyPrefix });
  const eventStream = new RedisEventStream({ client, keyPrefix });
  const cancellation = new RedisCancellation({
    client,
    keyPrefix,
    pollIntervalMs: options.cancellationPollMs,
  });
  const sessionStore = new RedisSessionStore({ client, keyPrefix });

  const agentSource: AgentSource =
    options.agentSource ?? ((identity: ExecutionIdentity) => createAgentForIdentity(identity));
  const turnRunner = new TurnRunner({ agentSource });

  const worker = new Worker(
    AGENT_TURN_QUEUE,
    async (job) => {
      const decoded = decodeExecutionRequest(job.data);
      if (Date.now() - job.timestamp > (options.maxQueueWaitMs ?? DEFAULT_MAX_QUEUE_WAIT_MS)) {
        return abortExpiredQueuedJob({
          eventStream,
          fencingToken: decoded.fencingToken,
          lock,
          request: decoded.request,
          runState,
        });
      }
      return runWorkerJob({
        cancellation,
        eventStream,
        lock,
        lockRefreshMs: options.lockRefreshMs ?? 5_000,
        request: decoded.request,
        fencingToken: decoded.fencingToken,
        runState,
        sessionStore,
        turnRunner,
      });
    },
    {
      autorun: false,
      concurrency: options.concurrency ?? 5,
      connection: bullMqClient,
      prefix: bullMqQueuePrefix(keyPrefix),
    },
  );

  const close = async () => {
    await worker.close();
    await Promise.all([disposeLinkloomConnection(), disposeSandboxConnection()]);
  };

  return {
    cancellation,
    close,
    eventStream,
    lock,
    runState,
    sessionStore,
    worker,
  };
}

const STALE_JOB_MESSAGE =
  "Stale job: the session lock is owned by a different run. Aborting to avoid a split-brain turn.";

export async function abortExpiredQueuedJob(options: {
  readonly request: ExecutionRequest;
  readonly fencingToken: number;
  readonly lock: RedisSessionLock;
  readonly runState: RedisRunStateStore;
  readonly eventStream: RedisEventStream;
}): Promise<ExecutionResult> {
  const { eventStream, fencingToken, lock, request, runState } = options;
  const result: ExecutionResult = {
    outcome: "error",
    failure: null,
    history: [],
    structuredOutput: null,
    finalText: "",
  };

  try {
    await eventStream.publishError(request.runId, QUEUE_WAIT_EXCEEDED_MESSAGE);
    await eventStream.publishResult(request.runId, result);
    await runState.recordFailed(request.runId, QUEUE_WAIT_EXCEEDED_MESSAGE);
    return result;
  } finally {
    await lock
      .release(request.identity.tenantId, request.identity.userId, request.sessionId, fencingToken)
      .catch(() => undefined);
  }
}

function extractUserMessage(messages: readonly AgentInputMessage[]): string {
  const last = messages[messages.length - 1];
  if (last && typeof last.content === "string") return last.content;
  return "";
}

export async function runWorkerJob(options: {
  readonly request: ExecutionRequest;
  readonly fencingToken: number;
  readonly turnRunner: TurnRunner;
  readonly lock: RedisSessionLock;
  readonly runState: RedisRunStateStore;
  readonly eventStream: RedisEventStream;
  readonly cancellation: RedisCancellation;
  readonly sessionStore: SessionStore;
  readonly lockRefreshMs?: number;
}): Promise<ExecutionResult> {
  const {
    cancellation,
    eventStream,
    fencingToken,
    lock,
    request,
    runState,
    sessionStore,
    turnRunner,
  } = options;

  const workerContext = extractTraceContext(request.traceContext);
  const workerSpan = getTracer().startSpan("agent_runtime.worker_turn", undefined, workerContext);
  setIdentityAttributes(workerSpan, request.identity, request.sessionId, request.runId);

  return context.with(trace.setSpan(workerContext, workerSpan), async () => {
    const holder = await lock.currentHolder(
      request.identity.tenantId,
      request.identity.userId,
      request.sessionId,
    );
    const ownsLock =
      holder !== null && holder.runId === request.runId && holder.fencingToken === fencingToken;

    if (!ownsLock) {
      workerSpan.addEvent("worker.stale_job", {
        "lock.expectedRunId": request.runId,
        "lock.expectedToken": fencingToken,
        "lock.actualRunId": holder?.runId ?? "(none)",
        "lock.actualToken": holder?.fencingToken ?? 0,
      });
      workerSpan.setStatus({ code: 1, message: STALE_JOB_MESSAGE });
      const result: ExecutionResult = {
        outcome: "error",
        failure: null,
        history: [],
        structuredOutput: null,
        finalText: "",
      };
      await eventStream.publishError(request.runId, STALE_JOB_MESSAGE);
      await eventStream.publishResult(request.runId, result);
      await runState.recordFailed(request.runId, STALE_JOB_MESSAGE);
      workerSpan.end();
      return result;
    }

    const abortController = new AbortController();
    const refreshMs = options.lockRefreshMs ?? 5_000;
    const refresh = startLeaseRefresh(lock, request, fencingToken, refreshMs, {
      onLost: () => {
        abortController.abort();
        void eventStream.publishError(
          request.runId,
          "Session lease lost; another worker may have taken over.",
        );
      },
    });

    let outcome: ExecutionResult | null = null;
    let loadedVersion = 0;
    try {
      const loaded = await sessionStore.loadSession(request.identity, request.sessionId);
      loadedVersion = loaded.version;
      const history = loaded.record?.history ?? [];

      const userMessage = extractUserMessage(request.messages);
      const messages = buildTurnMessages(history, userMessage);
      const workerRequest: ExecutionRequest = { ...request, messages };

      await runState.recordRunning(request.runId);
      await eventStream.publishLifecycle(request.runId, "started");

      const handle = turnRunner.start(workerRequest, abortController.signal);

      outcome = await relayEvents({
        eventStream,
        request,
        events: handle.events,
        cancellation,
        abortController,
      });

      const finalResult = outcome ?? (await handle.result);

      await commitOutcome({
        request,
        result: finalResult,
        sessionStore,
        sessionVersion: loadedVersion,
        runState,
        span: workerSpan,
      });

      await recordTerminalState(runState, request, finalResult);
      workerSpan.setAttribute("run.outcome", finalResult.outcome);
      return finalResult;
    } catch (error) {
      workerSpan.recordException(error instanceof Error ? error : new Error(String(error)));
      workerSpan.setStatus({
        code: 1,
        message: error instanceof Error ? error.message : String(error),
      });
      const result: ExecutionResult = {
        outcome: abortController.signal.aborted ? "cancelled" : "error",
        failure: null,
        history: [],
        structuredOutput: null,
        finalText: "",
      };
      if (result.outcome === "cancelled") {
        await eventStream.publishLifecycle(request.runId, "cancelled");
      } else {
        await eventStream.publishError(
          request.runId,
          error instanceof Error ? error.message : String(error),
        );
      }
      await eventStream.publishResult(request.runId, result);
      await recordTerminalState(runState, request, result);
      return result;
    } finally {
      refresh.stop();
      await eventStream.trim(request.runId).catch(() => undefined);
      await lock
        .release(
          request.identity.tenantId,
          request.identity.userId,
          request.sessionId,
          fencingToken,
        )
        .catch(() => undefined);
      workerSpan.end();
    }
  });
}

async function relayEvents(options: {
  readonly eventStream: RedisEventStream;
  readonly request: ExecutionRequest;
  readonly events: AsyncIterable<ExecutionEvent>;
  readonly cancellation: RedisCancellation;
  readonly abortController: AbortController;
}): Promise<ExecutionResult | null> {
  const { cancellation, eventStream, events, request } = options;
  const watch = cancellation.watch(request.runId, options.abortController.signal);
  let resolved: ExecutionResult | null = null;

  void watch.then((cancelled) => {
    if (cancelled) options.abortController.abort();
  });

  for await (const event of events) {
    if (event.kind === "ui") {
      await eventStream.publishUi(request.runId, event.update);
    } else if (event.kind === "lifecycle" && event.phase === "cancelled") {
      await eventStream.publishLifecycle(request.runId, "cancelled");
    } else if (event.kind === "result") {
      resolved = event.result;
      await eventStream.publishResult(request.runId, event.result);
      return resolved;
    }
  }
  return resolved;
}

async function commitOutcome(options: {
  readonly request: ExecutionRequest;
  readonly result: ExecutionResult;
  readonly sessionStore: SessionStore;
  readonly sessionVersion: number;
  readonly runState: RedisRunStateStore;
  readonly span: Span;
}): Promise<void> {
  const { request, result, sessionStore, sessionVersion, runState, span } = options;
  const started = (await runState.get(request.runId))?.startedAt ?? Date.now();
  const preserve = result.outcome === "cancelled" || result.outcome === "error";
  if (preserve) {
    await sessionStore.recordRun(request.identity, request.sessionId, {
      finishedAt: Date.now(),
      outcome: result.outcome,
      runId: request.runId,
      startedAt: started,
    });
    return;
  }
  const committed = await sessionStore.commitSession(
    request.identity,
    request.sessionId,
    {
      failure: result.failure,
      history: result.history,
      structuredOutput: result.structuredOutput,
    },
    sessionVersion,
  );
  if (!committed) {
    span.addEvent("session.commit.conflict", { "session.version_expected": sessionVersion });
  }
  await sessionStore.recordRun(request.identity, request.sessionId, {
    finishedAt: Date.now(),
    outcome: result.outcome,
    runId: request.runId,
    startedAt: started,
  });
}

async function recordTerminalState(
  runState: RedisRunStateStore,
  request: ExecutionRequest,
  result: ExecutionResult,
): Promise<void> {
  switch (result.outcome) {
    case "success":
      await runState.recordCompleted(request.runId);
      break;
    case "failure":
      await runState.recordFailed(request.runId);
      break;
    case "cancelled":
      await runState.recordCancelled(request.runId);
      break;
    default:
      await runState.recordFailed(request.runId);
  }
}

type LeaseRefresh = { stop: () => void };

function startLeaseRefresh(
  lock: RedisSessionLock,
  request: ExecutionRequest,
  fencingToken: number,
  refreshMs: number,
  hooks?: { readonly onLost?: () => void },
): LeaseRefresh {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tick = async () => {
    if (stopped) return;
    try {
      const ok = await lock.refresh(
        request.identity.tenantId,
        request.identity.userId,
        request.sessionId,
        fencingToken,
      );
      if (!ok) {
        stopped = true;
        hooks?.onLost?.();
        return;
      }
    } catch {
      // Transient Redis errors: keep trying until the run ends.
    }
    if (stopped) return;
    timer = setTimeout(tick, refreshMs);
  };

  timer = setTimeout(tick, refreshMs);

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
