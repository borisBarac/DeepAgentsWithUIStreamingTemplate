import { randomUUID } from "node:crypto";

import type { AgentInputMessage, UiUpdate } from "@deep-agent-template/core/interaction-stream";

import { createCurrentContext } from "../current-context.ts";
import { InMemorySessionStore } from "./store.ts";
import {
  context,
  getTracer,
  injectTraceContext,
  markError,
  recordRequestDuration,
  type Span,
  setIdentityAttributes,
  setOutcome,
  trace,
} from "./telemetry.ts";
import type {
  AgentExecutionHandle,
  AgentExecutor,
  ExecutionIdentity,
  ExecutionRequest,
  ExecutionResult,
  SessionRecord,
  SessionStore,
} from "./types.ts";

export type AgentRequestRunInput = {
  readonly identity: ExecutionIdentity;
  readonly sessionId: string;
  readonly message: string;
  readonly includeActivity: boolean;
};

export type AgentRequestHandle = {
  readonly updates: AsyncIterable<UiUpdate>;
  readonly result: Promise<ExecutionResult>;
};

class UiUpdateQueue implements AsyncIterable<UiUpdate> {
  #closed = false;
  #error: unknown;
  #queue: UiUpdate[] = [];
  #waiter: (() => void) | undefined;

  push(update: UiUpdate): void {
    if (this.#closed) return;
    this.#queue.push(update);
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

  async *[Symbol.asyncIterator](): AsyncIterator<UiUpdate> {
    while (true) {
      if (this.#queue.length > 0) {
        yield this.#queue.shift() as UiUpdate;
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

function toInputMessages(history: readonly unknown[], message: string): AgentInputMessage[] {
  return [
    ...(history as AgentInputMessage[]),
    {
      additional_kwargs: { transient_context: true },
      content: createCurrentContext(),
      role: "user",
    },
    { content: message, role: "user" },
  ];
}

// Runs a single request: load session state, invoke the executor, relay UI
// updates, and commit state only after a completed turn. Failures and
// cancellations preserve the previously committed session state. The setup up
// to execution runs synchronously so the agent turn begins promptly; event
// relay, commit, and span teardown happen in a detached consumer.
export class AgentRequestRunner {
  readonly #store: SessionStore;
  readonly #executor: AgentExecutor;
  readonly #requireStructuredOutput: boolean;

  constructor(options: {
    executor: AgentExecutor;
    store?: SessionStore;
    requireStructuredOutput?: boolean;
  }) {
    this.#store = options.store ?? new InMemorySessionStore();
    this.#executor = options.executor;
    this.#requireStructuredOutput = options.requireStructuredOutput ?? true;
  }

  run(input: AgentRequestRunInput, signal: AbortSignal): AgentRequestHandle {
    const out = new UiUpdateQueue();
    let resolveResult!: (result: ExecutionResult) => void;
    const result = new Promise<ExecutionResult>((resolve) => {
      resolveResult = resolve;
    });

    const tracer = getTracer();
    const runId = randomUUID();
    const startedAt = Date.now();
    const rootSpan = tracer.startSpan("agent.request");
    setIdentityAttributes(rootSpan, input.identity, input.sessionId, runId);
    const rootContext = trace.setSpan(context.active(), rootSpan);

    context.with(rootContext, () => {
      const history = this.#loadSession(input, runId);
      const { executeSpan, handlePromise } = this.#execute(input, runId, history, signal);
      void this.#consume(
        input,
        runId,
        executeSpan,
        rootSpan,
        handlePromise,
        out,
        resolveResult,
        startedAt,
      );
    });

    return { updates: out, result };
  }

  #loadSession(input: AgentRequestRunInput, runId: string): readonly unknown[] {
    const tracer = getTracer();
    const span = tracer.startSpan("agent_runtime.load_session");
    setIdentityAttributes(span, input.identity, input.sessionId, runId);
    try {
      return this.#store.loadSession(input.identity, input.sessionId)?.history ?? [];
    } finally {
      span.end();
    }
  }

  #execute(
    input: AgentRequestRunInput,
    runId: string,
    history: readonly unknown[],
    signal: AbortSignal,
  ): { executeSpan: Span; handlePromise: Promise<AgentExecutionHandle> } {
    const tracer = getTracer();
    const executeSpan = tracer.startSpan("agent_runtime.execute");
    setIdentityAttributes(executeSpan, input.identity, input.sessionId, runId);

    const handle = context.with(trace.setSpan(context.active(), executeSpan), () => {
      const carrier = injectTraceContext();
      const request: ExecutionRequest = {
        identity: input.identity,
        messages: toInputMessages(history, input.message),
        options: {
          includeActivity: input.includeActivity,
          requireStructuredOutput: this.#requireStructuredOutput,
        },
        runId,
        sessionId: input.sessionId,
        traceContext: carrier,
      };
      return this.#executor.execute(request, signal);
    });

    const handlePromise: Promise<AgentExecutionHandle> = Promise.resolve(handle);
    return { executeSpan, handlePromise };
  }

  async #consume(
    input: AgentRequestRunInput,
    runId: string,
    executeSpan: Span,
    rootSpan: Span,
    handlePromise: Promise<AgentExecutionHandle>,
    out: UiUpdateQueue,
    resolveResult: (result: ExecutionResult) => void,
    startedAt: number,
  ): Promise<void> {
    try {
      const handle = await handlePromise;
      let resolved: ExecutionResult | null = null;
      for await (const event of handle.events) {
        if (event.kind === "ui") {
          out.push(event.update);
        } else if (event.kind === "result") {
          resolved = event.result;
        }
      }
      const final = resolved ?? (await handle.result);
      setOutcome(executeSpan, final.outcome);
      executeSpan.end();
      await this.#commit(input, runId, final, startedAt);
      setOutcome(rootSpan, final.outcome);
      resolveResult(final);
    } catch (error) {
      markError(rootSpan, error);
      resolveResult({
        failure: null,
        finalText: "",
        history: [],
        outcome: "error",
        structuredOutput: null,
      });
    } finally {
      recordRequestDuration(Date.now() - startedAt);
      out.close();
      rootSpan.end();
    }
  }

  async #commit(
    input: AgentRequestRunInput,
    runId: string,
    result: ExecutionResult,
    startedAt: number,
  ): Promise<void> {
    const finishedAt = Date.now();
    const tracer = getTracer();
    const preserve = result.outcome === "cancelled" || result.outcome === "error";
    if (preserve) {
      this.#store.recordRun(input.identity, input.sessionId, {
        finishedAt,
        outcome: result.outcome,
        runId,
        startedAt,
      });
      return;
    }
    const span = tracer.startSpan("agent_runtime.commit_session");
    setIdentityAttributes(span, input.identity, input.sessionId, runId);
    try {
      const record: SessionRecord = {
        failure: result.failure,
        history: result.history,
        structuredOutput: result.structuredOutput,
      };
      this.#store.commitSession(input.identity, input.sessionId, record);
      this.#store.recordRun(input.identity, input.sessionId, {
        finishedAt,
        outcome: result.outcome,
        runId,
        startedAt,
      });
    } finally {
      span.end();
    }
  }
}
