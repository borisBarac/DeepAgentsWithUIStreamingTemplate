import { randomUUID } from "node:crypto";

import {
  type AgentInputMessage,
  createInteractionStream,
  type InteractionStreamFailure,
  type ModelUiOutput,
  type StreamableAgent,
  type UiUpdate,
} from "@deep-agent-template/core/interaction-stream";

import {
  type Context,
  context,
  extractTraceContext,
  getTracer,
  markCancelled,
  markError,
  markFailure,
  markSuccess,
  recordRunFinished,
  recordRunStarted,
  recordStreamEvent,
  resolveModelProvider,
  setIdentityAttributes,
  setOutcomeAttribute,
  trace,
} from "./telemetry.ts";
import { createInternalThreadKey } from "./thread-key.ts";
import type {
  AgentExecutionHandle,
  AgentExecutor,
  ExecutionEvent,
  ExecutionIdentity,
  ExecutionRequest,
  ExecutionResult,
  RunOutcome,
} from "./types.ts";

export type AgentSource = (
  identity: ExecutionIdentity,
) => StreamableAgent | Promise<StreamableAgent>;

type InteractionOutcome = {
  outcome: RunOutcome;
  failure: InteractionStreamFailure | null;
  history: readonly unknown[];
  structuredOutput: ModelUiOutput | null;
  finalText: string;
};

export class AsyncEventQueue implements AsyncIterable<ExecutionEvent> {
  #closed = false;
  #error: unknown;
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

  throw(error: unknown): void {
    this.#error = error;
    this.close();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<ExecutionEvent> {
    while (true) {
      if (this.#queue.length > 0) {
        yield this.#queue.shift() as ExecutionEvent;
        continue;
      }
      if (this.#error) throw this.#error;
      if (this.#closed) return;
      await new Promise<void>((resolve) => {
        this.#waiter = resolve;
      });
    }
  }
}

export async function* raceWithAbort<T>(
  iter: AsyncIterable<T>,
  signal: AbortSignal,
): AsyncGenerator<T> {
  if (signal.aborted) return;
  const iterator = iter[Symbol.asyncIterator]();
  const abort = new Promise<IteratorResult<T>>((resolve) => {
    signal.addEventListener("abort", () => resolve({ done: true, value: undefined as T }), {
      once: true,
    });
  });
  try {
    while (true) {
      const step = await Promise.race([iterator.next(), abort]);
      if (step.done) break;
      yield step.value;
      if (signal.aborted) break;
    }
  } finally {
    iterator.return?.();
  }
}

function isThenable<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

export type TurnRunnerOptions = {
  readonly agentSource: AgentSource;
};

export class TurnRunner {
  readonly #agentSource: AgentSource;

  constructor(options: TurnRunnerOptions) {
    this.#agentSource = options.agentSource;
  }

  start(
    request: ExecutionRequest,
    signal: AbortSignal,
  ): {
    events: AsyncEventQueue;
    result: Promise<ExecutionResult>;
    turnSpan: ReturnType<ReturnType<typeof getTracer>["startSpan"]>;
  } {
    const tracer = getTracer();
    const turnContext = extractTraceContext(request.traceContext);
    const turnSpan = tracer.startSpan("agent_runtime.execute_turn", undefined, turnContext);
    setIdentityAttributes(turnSpan, request.identity, request.sessionId, request.runId);
    const executionId = randomUUID();
    turnSpan.setAttribute("execution.id", executionId);

    const queue = new AsyncEventQueue();
    let resolveResult!: (result: ExecutionResult) => void;
    const result = new Promise<ExecutionResult>((resolve) => {
      resolveResult = resolve;
    });

    const startedAt = Date.now();
    recordRunStarted();

    const activeContext = trace.setSpan(turnContext, turnSpan);
    void context.with(activeContext, () =>
      this.#runTurn(request, signal, queue, activeContext, executionId, resolveResult, startedAt),
    );

    void result
      .then((resolved) => {
        setOutcomeAttribute(turnSpan, resolved.outcome);
        turnSpan.end();
      })
      .catch(() => {
        setOutcomeAttribute(turnSpan, "error");
        turnSpan.end();
      });

    return { events: queue, result, turnSpan };
  }

  async #runTurn(
    request: ExecutionRequest,
    signal: AbortSignal,
    queue: AsyncEventQueue,
    turnContext: Context,
    executionId: string,
    resolveResult: (result: ExecutionResult) => void,
    startedAt: number,
  ): Promise<void> {
    const tracer = getTracer();
    let eventCount = 0;
    try {
      const agent = await this.#acquireAgent(turnContext, request, executionId);

      const runSpan = tracer.startSpan("agent.run", undefined, turnContext);
      runSpan.setAttribute("execution.id", executionId);
      runSpan.setAttribute("model.provider", resolveModelProvider());
      setIdentityAttributes(runSpan, request.identity, request.sessionId, request.runId);
      await context.with(trace.setSpan(turnContext, runSpan), async () => {
        const base = await this.#runInteraction(request, signal, agent, queue, () => {
          eventCount += 1;
        });
        runSpan.setAttribute("run.event_count", eventCount);
        const outcome = base.outcome;
        if (outcome === "success") markSuccess(runSpan);
        else if (outcome === "failure") markFailure(runSpan);
        else if (outcome === "cancelled") markCancelled(runSpan);
        const result: ExecutionResult = { ...base, outcome };
        queue.push({ kind: "result", result });
        resolveResult(result);
        recordRunFinished(outcome, Date.now() - startedAt);
        runSpan.end();
      });
    } catch (error) {
      const outcome: RunOutcome = signal.aborted ? "cancelled" : "error";
      if (outcome === "error") {
        queue.push({ kind: "ui", update: { message: formatErrorMessage(error), type: "error" } });
        recordStreamEvent("error");
      }
      const result: ExecutionResult = {
        outcome,
        failure: null,
        history: [],
        structuredOutput: null,
        finalText: "",
      };
      queue.push({ kind: "result", result });
      resolveResult(result);
      recordRunFinished(outcome, Date.now() - startedAt);
    } finally {
      queue.close();
    }
  }

  async #acquireAgent(
    turnContext: Context,
    request: ExecutionRequest,
    executionId: string,
  ): Promise<StreamableAgent> {
    const tracer = getTracer();
    const span = tracer.startSpan("agent_runtime.create_agent", undefined, turnContext);
    span.setAttribute("execution.id", executionId);
    setIdentityAttributes(span, request.identity, request.sessionId, request.runId);
    try {
      const maybeAgent = this.#agentSource(request.identity);
      if (isThenable(maybeAgent)) {
        return await maybeAgent;
      }
      return maybeAgent;
    } catch (error) {
      markError(span, error);
      throw error;
    } finally {
      span.end();
    }
  }

  async #runInteraction(
    request: ExecutionRequest,
    signal: AbortSignal,
    agent: StreamableAgent,
    queue: AsyncEventQueue,
    onEvent: () => void,
  ): Promise<InteractionOutcome> {
    const threadKey = createInternalThreadKey(
      request.identity.tenantId,
      request.identity.userId,
      request.sessionId,
    );
    const interaction = createInteractionStream({
      agent,
      includeActivity: request.options.includeActivity,
      messages: request.messages as AgentInputMessage[],
      requireStructuredOutput: request.options.requireStructuredOutput,
      sessionId: threadKey,
    });
    void interaction.result.catch(() => undefined);

    queue.push({ kind: "lifecycle", phase: "started" });

    for await (const update of raceWithAbort<UiUpdate>(interaction.updates, signal)) {
      queue.push({ kind: "ui", update });
      recordStreamEvent(update.type);
      onEvent();
    }

    if (signal.aborted) {
      queue.push({ kind: "lifecycle", phase: "cancelled" });
      return {
        outcome: "cancelled",
        failure: null,
        history: [],
        structuredOutput: null,
        finalText: "",
      };
    }

    const streamResult = await interaction.result;
    const outcome: RunOutcome = streamResult.failure ? "failure" : "success";
    return {
      outcome,
      failure: streamResult.failure,
      history: streamResult.history,
      structuredOutput: streamResult.structuredOutput,
      finalText: streamResult.finalText,
    };
  }
}

const MAX_ERROR_MESSAGE_LENGTH = 4_000;

function formatErrorMessage(error: unknown): string {
  const message = (error instanceof Error ? error.message : String(error)).trim();
  return [...(message || "Agent request failed.")].slice(0, MAX_ERROR_MESSAGE_LENGTH).join("");
}

export type { AgentExecutionHandle, AgentExecutor };
