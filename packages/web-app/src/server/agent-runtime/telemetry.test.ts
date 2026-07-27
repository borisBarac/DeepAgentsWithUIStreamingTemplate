import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import type {
  AgentInputMessage,
  StreamableAgent,
  UiUpdate,
} from "@deep-agent-template/core/interaction-stream";
import { context, metrics, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  type MetricData,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { InlineAgentExecutor } from "./executor.ts";
import { AgentRequestRunner } from "./request-runner.ts";
import { InMemorySessionStore } from "./store.ts";

const spanExporter = new InMemorySpanExporter();
const tracerProvider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(spanExporter)],
});
trace.setGlobalTracerProvider(tracerProvider);
(
  context as unknown as { setGlobalContextManager: (manager: unknown) => void }
).setGlobalContextManager(new AsyncLocalStorageContextManager());

const metricReader = new PeriodicExportingMetricReader({
  exporter: new InMemoryMetricExporter(AggregationTemporality.DELTA),
  exportIntervalMillis: 60_000,
});
metrics.setGlobalMeterProvider(new MeterProvider({ readers: [metricReader] }));

beforeEach(() => {
  spanExporter.reset();
});
afterEach(async () => {
  await metricReader.collect().catch(() => undefined);
});

async function collectMetrics(): Promise<MetricData[]> {
  const result = await metricReader.collect();
  return (result.resourceMetrics?.scopeMetrics ?? []).flatMap((s) => s.metrics ?? []);
}

function asyncIterableFrom<T>(items: T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function fakeAgent(options: {
  structuredResponse?: unknown;
  output?: Deferred<{ messages: never[] }>;
}): StreamableAgent {
  return {
    invoke: async () => ({ messages: [] }),
    async streamEvents(input: { messages: AgentInputMessage[] }) {
      void input;
      return {
        messages: asyncIterableFrom([{ text: asyncIterableFrom([]) }]),
        output: options.output
          ? options.output.promise.then(() => ({
              messages: [],
              structuredResponse: options.structuredResponse,
            }))
          : Promise.resolve({ messages: [], structuredResponse: options.structuredResponse }),
      };
    },
  };
}

const ID = { tenantId: "tenant-a", userId: "user-1" };

function makeRunner(
  agentSource: () => Promise<StreamableAgent> | StreamableAgent,
): AgentRequestRunner {
  const store = new InMemorySessionStore();
  const executor = new InlineAgentExecutor({ agentSource: async () => agentSource() });
  return new AgentRequestRunner({ executor, store });
}

async function runTurn(
  runner: AgentRequestRunner,
  message: string,
  signal: AbortSignal,
  sessionId = "s1",
): Promise<{ updates: UiUpdate[]; outcome: string }> {
  const handle = runner.run({ identity: ID, includeActivity: true, message, sessionId }, signal);
  const updates: UiUpdate[] = [];
  for await (const u of handle.updates) updates.push(u);
  const result = await handle.result;
  return { outcome: result.outcome, updates };
}

const SUCCESS_OUTPUT = {
  version: 1,
  updates: [{ type: "message", text: "SENSITIVE-OUTPUT-TOKEN" }],
};

describe("telemetry spans", () => {
  it("records the full lifecycle with parent-child links across the carrier", async () => {
    const runner = makeRunner(() => fakeAgent({ structuredResponse: SUCCESS_OUTPUT }));
    await runTurn(runner, "SECRET-MESSAGE-TOKEN", new AbortController().signal);

    const spans = spanExporter.getFinishedSpans();
    const names = spans.map((s) => s.name);
    for (const expected of [
      "agent.request",
      "agent_runtime.load_session",
      "agent_runtime.execute",
      "agent_runtime.execute_turn",
      "agent_runtime.create_agent",
      "agent.run",
      "agent_runtime.commit_session",
    ]) {
      expect(names).toContain(expected);
    }

    const byName = (name: string): ReadableSpan | undefined => spans.find((s) => s.name === name);
    const execute = byName("agent_runtime.execute");
    const turn = byName("agent_runtime.execute_turn");
    const create = byName("agent_runtime.create_agent");
    const agentRun = byName("agent.run");

    // The executor turn context is re-established from the injected W3C
    // carrier: agent_runtime.execute_turn is a child of agent_runtime.execute,
    // and the executor's child spans are children of agent_runtime.execute_turn.
    expect(turn?.parentSpanContext?.spanId).toBe(execute?.spanContext().spanId);
    expect(create?.parentSpanContext?.spanId).toBe(turn?.spanContext().spanId);
    expect(agentRun?.parentSpanContext?.spanId).toBe(turn?.spanContext().spanId);
  });

  it("closes every span on each terminal path and returns active_runs to zero", async () => {
    await runTurn(
      makeRunner(() => fakeAgent({ structuredResponse: SUCCESS_OUTPUT })),
      "ok",
      new AbortController().signal,
      "ok",
    );
    const invalid = { version: 1, updates: [{ type: "error", message: "bad" }] };
    await runTurn(
      makeRunner(() => fakeAgent({ structuredResponse: invalid })),
      "bad",
      new AbortController().signal,
      "bad",
    );

    const output = createDeferred<{ messages: never[] }>();
    const cancelRunner = makeRunner(() =>
      fakeAgent({ structuredResponse: SUCCESS_OUTPUT, output }),
    );
    const controller = new AbortController();
    const handle = cancelRunner.run(
      { identity: ID, includeActivity: false, message: "x", sessionId: "cancel" },
      controller.signal,
    );
    controller.abort();
    await handle.result;

    // Every exported span is ended (SimpleSpanProcessor only exports ended spans).
    const spans = spanExporter.getFinishedSpans();
    expect(spans.length).toBeGreaterThan(0);
    expect(spans.every((s) => s.ended)).toBe(true);

    // Every terminal path runs an executor turn, including cancellation.
    const turnCount = spans.filter((s) => s.name === "agent_runtime.execute_turn").length;
    expect(turnCount).toBe(3);

    const metrics = await collectMetrics();
    const active = metrics.find((m) => m.descriptor.name === "agent.active_runs");
    const activeValues = (active?.dataPoints ?? []).map((p) => (p as { value: number }).value);
    // Three started runs (3 x +1) balanced by three finished runs (3 x -1).
    const net = activeValues.reduce((sum, v) => sum + v, 0);
    expect(net).toBe(0);
  });
});

describe("telemetry metrics", () => {
  it("records run outcomes, durations, and event counts without high-cardinality attributes", async () => {
    await runTurn(
      makeRunner(() => fakeAgent({ structuredResponse: SUCCESS_OUTPUT })),
      "ok",
      new AbortController().signal,
    );
    const metrics = await collectMetrics();
    const names = metrics.map((m) => m.descriptor.name);

    expect(names).toContain("agent.runs");
    expect(names).toContain("agent.run.duration");
    expect(names).toContain("agent.request.duration");
    expect(names).toContain("agent.stream.events");

    // Duration histograms recorded real values.
    for (const durationName of ["agent.run.duration", "agent.request.duration"]) {
      const histogram = metrics.find((m) => m.descriptor.name === durationName);
      const counts = (histogram?.dataPoints ?? []).map(
        (p) => (p as { value: { count?: number } }).value?.count ?? 0,
      );
      expect(counts.reduce((sum, c) => sum + c, 0)).toBeGreaterThan(0);
    }

    // Event counts were recorded.
    const streamEvents = metrics.find((m) => m.descriptor.name === "agent.stream.events");
    const eventTotal = (streamEvents?.dataPoints ?? [])
      .map((p) => (p as { value: number }).value)
      .reduce((sum, v) => sum + v, 0);
    expect(eventTotal).toBeGreaterThan(0);

    // No high-cardinality identifiers leak into metric attributes.
    const serialized = JSON.stringify(metrics);
    for (const forbidden of ["tenant-a", "user-1", "ok", "s1"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("distinguishes success, failure, and cancelled outcomes on agent.runs", async () => {
    await runTurn(
      makeRunner(() => fakeAgent({ structuredResponse: SUCCESS_OUTPUT })),
      "ok",
      new AbortController().signal,
      "ok",
    );
    const invalid = { version: 1, updates: [{ type: "error", message: "bad" }] };
    await runTurn(
      makeRunner(() => fakeAgent({ structuredResponse: invalid })),
      "bad",
      new AbortController().signal,
      "bad",
    );

    const output = createDeferred<{ messages: never[] }>();
    const cancelRunner = makeRunner(() =>
      fakeAgent({ structuredResponse: SUCCESS_OUTPUT, output }),
    );
    const controller = new AbortController();
    const handle = cancelRunner.run(
      { identity: ID, includeActivity: false, message: "x", sessionId: "cancel" },
      controller.signal,
    );
    controller.abort();
    await handle.result;

    const metrics = await collectMetrics();
    const runs = metrics.find((m) => m.descriptor.name === "agent.runs");
    const outcomes = new Set(
      (runs?.dataPoints ?? []).map((p) => (p.attributes as { outcome?: string }).outcome),
    );
    expect(outcomes.has("success")).toBe(true);
    expect(outcomes.has("failure")).toBe(true);
    expect(outcomes.has("cancelled")).toBe(true);
  });
});

describe("telemetry privacy", () => {
  it("never records message or output content in span attributes or events", async () => {
    await runTurn(
      makeRunner(() => fakeAgent({ structuredResponse: SUCCESS_OUTPUT })),
      "SECRET-MESSAGE-TOKEN",
      new AbortController().signal,
    );

    const spans = spanExporter.getFinishedSpans();
    const serialized = JSON.stringify(
      spans.map((s) => ({
        attributes: s.attributes,
        events: s.events?.map((e) => ({ name: e.name, attributes: e.attributes })),
      })),
    );
    expect(serialized).not.toContain("SECRET-MESSAGE-TOKEN");
    expect(serialized).not.toContain("SENSITIVE-OUTPUT-TOKEN");
  });
});
