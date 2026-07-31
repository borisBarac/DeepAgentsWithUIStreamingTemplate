import type {
  AgentInputMessage,
  StreamableAgent,
} from "@deep-agent-template/core/interaction-stream";
import type { Redis } from "ioredis";
import type { AgentSource } from "../src/server/agent-runtime/turn-runner.ts";
import type {
  AgentExecutionHandle,
  ExecutionEvent,
  ExecutionIdentity,
  ExecutionRequest,
  ExecutionResult,
} from "../src/server/agent-runtime/types.ts";
import {
  closeRedisClients,
  getBullMqRedis,
  getSharedRedis,
  resolveRedisOptions,
} from "../src/server/redis/client.ts";
import { createAgentWorker, type WorkerServices } from "../src/server/worker/agent-worker.ts";
import {
  type BullMqAgentExecutor,
  buildBullMqAgentExecutor,
} from "../src/server/worker/bullmq-executor.ts";

export type WorkerStack = {
  readonly executor: BullMqAgentExecutor;
  readonly services: WorkerServices;
  readonly stop: () => Promise<void>;
};

// Boots the worker stack in-process for an e2e run. A BullMQ Worker (via
// createAgentWorker) consumes agent-turn jobs; a BullMqAgentExecutor enqueues
// turns and projects the result handle back over the run's Redis stream. Both
// share the Redis pointed at by REDIS_URL (set by redis-harness before this).
//
// Production runs the Queue (API process) and Worker (worker process) in
// separate processes, each with its own ioredis connection. BullMQ uses a
// passed ioredis instance as-is — it does NOT duplicate for its blocking reads
// — so in-process we MUST hand the Queue a dedicated connection, otherwise the
// Worker's blocking BZPOPMIN starves the Queue's enqueue commands. The Worker
// keeps the bullMq singleton; the Queue gets a fresh connection below.
//
// CONNECTION TOPOLOGY: production runs the executor (API) and worker in
// separate processes, so each has its own ioredis connection. In-process we
// must replicate that separation, otherwise the executor's blocking XREAD
// (eventStream.read, BLOCK ~1s) monopolizes the shared connection and starves
// the worker's lock/session/run-state commands — adding multi-second latency
// before the worker can even publish "started". So the worker keeps the shared
// singleton; the executor gets TWO dedicated connections: one for its Queue
// (BullMQ rejects ioredis key prefixes) and one for its lock/run-state/stream
// reads (keyPrefix-matched so keys line up with the worker's).
export async function startWorkerStack(options: {
  readonly agentSource: AgentSource;
  readonly concurrency?: number;
}): Promise<WorkerStack> {
  const { keyPrefix, url } = resolveRedisOptions();
  // Worker consumes the shared singleton for its (non-blocking) commands.
  await getSharedRedis();
  await getBullMqRedis();

  const services = await createAgentWorker({
    agentSource: options.agentSource,
    concurrency: options.concurrency ?? 1,
    // Tight poll so cancellation tests resolve in milliseconds, not seconds.
    cancellationPollMs: 10,
  });
  services.worker.run();

  const { default: IORedis } = await import("ioredis");
  // Queue connection: BullMQ rejects ioredis key prefixes, manages its own.
  const queueClient: Redis = new IORedis(url, { maxRetriesPerRequest: null });
  // Executor connection: dedicated so its blocking stream reads never block the
  // worker's commands. keyPrefix is NOT forwarded to ioredis — every Redis
  // store (lock/run-state/stream/cancellation) already bakes keyPrefix into its
  // keys via createRedisKeys(), and forwarding it here would double-prefix every
  // key, putting the executor on a disjoint keyspace from the worker.
  const executorClient: Redis = new IORedis(url, { maxRetriesPerRequest: 3 });
  const executor = buildBullMqAgentExecutor({
    bullMqClient: queueClient,
    client: executorClient,
    keyPrefix,
  });

  const stop = async () => {
    await services.close().catch(() => undefined);
    await queueClient.quit().catch(() => undefined);
    await executorClient.quit().catch(() => undefined);
    await closeRedisClients();
  };

  return { executor, services, stop };
}

const E2E_IDENTITY: ExecutionIdentity = {
  tenantId: "guests",
  userId: "00000000-0000-4000-8000-0000000000e2",
};

export function buildRequest(overrides: {
  readonly sessionId: string;
  readonly content: string;
  readonly runId?: string;
  readonly identity?: ExecutionIdentity;
  readonly includeActivity?: boolean;
}): ExecutionRequest {
  return {
    identity: overrides.identity ?? E2E_IDENTITY,
    sessionId: overrides.sessionId,
    runId: overrides.runId ?? crypto.randomUUID(),
    messages: [{ content: overrides.content, role: "user" }] as AgentInputMessage[],
    options: {
      includeActivity: overrides.includeActivity ?? false,
      requireStructuredOutput: true,
    },
    traceContext: {},
  };
}

export type DrainedTurn = {
  readonly events: ExecutionEvent[];
  readonly result: ExecutionResult;
};

// Drain an execution handle to completion: collect every streamed event and
// await the terminal result. The signal aborts the turn (the executor flips the
// Redis cancellation flag; the worker's poller aborts the interaction stream).
export async function drainHandle(handle: AgentExecutionHandle): Promise<DrainedTurn> {
  const events: ExecutionEvent[] = [];
  for await (const event of handle.events) events.push(event);
  const result = await handle.result;
  return { events, result };
}

export async function submitTurn(
  executor: BullMqAgentExecutor,
  request: ExecutionRequest,
  signal: AbortSignal,
): Promise<DrainedTurn> {
  return drainHandle(await executor.execute(request, signal));
}

function neverAsyncIterable<T>(): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator](): AsyncIterator<T> {
      // Block forever. The runner's raceWithAbort stops iterating without ever
      // pulling from this generator, so the pending promise is abandoned when
      // the turn is aborted.
      await new Promise<never>(() => undefined);
    },
  };
}

// A StreamableAgent whose turn never completes on its own. Drives the
// cancellation and session-busy paths through the real worker + Redis path with
// no LLM cost: the turn hangs until the worker's cancellation poller aborts it.
export function hangingAgent(): StreamableAgent {
  return {
    async streamEvents() {
      return {
        messages: neverAsyncIterable(),
        output: new Promise<never>(() => undefined),
      };
    },
    async invoke() {
      return { messages: [] };
    },
  };
}
