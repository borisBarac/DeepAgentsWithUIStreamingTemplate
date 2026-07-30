import {
  type Context,
  context,
  defaultTextMapGetter,
  defaultTextMapSetter,
  metrics,
  type Span,
  SpanStatusCode,
  type Tracer,
  trace,
} from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";

import type { ExecutionIdentity, RunOutcome, TraceContextCarrier } from "./types.ts";

const TELEMETRY_NAME = "deep-agent-template/web-app";

const W3C = new W3CTraceContextPropagator();

export function getTracer(): Tracer {
  return trace.getTracer(TELEMETRY_NAME);
}

export function injectTraceContext(): TraceContextCarrier {
  const carrier: Record<string, string> = {};
  W3C.inject(context.active(), carrier, defaultTextMapSetter);
  const traceparent = carrier.traceparent;
  if (!traceparent) return {};
  const tracestate = carrier.tracestate;
  return tracestate ? { traceparent, tracestate } : { traceparent };
}

export function extractTraceContext(carrier: TraceContextCarrier): Context {
  const bag: Record<string, string> = {};
  if (carrier.traceparent) bag.traceparent = carrier.traceparent;
  if (carrier.tracestate) bag.tracestate = carrier.tracestate;
  if (!bag.traceparent) return context.active();
  return W3C.extract(context.active(), bag, defaultTextMapGetter);
}

function meter() {
  return metrics.getMeter(TELEMETRY_NAME, "0.1.0");
}

export function resolveModelProvider(): string {
  const baseUrl = process.env.LLM_BASE_URL;
  if (typeof baseUrl === "string" && /api\.openai\.com/i.test(baseUrl)) return "openai";
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.LLM_API_KEY || process.env.LLM_BASE_URL) return "custom";
  return "unknown";
}

export function recordRunStarted(): void {
  meter().createUpDownCounter("agent.active_runs").add(1);
}

export function recordRunFinished(outcome: RunOutcome, durationMs: number): void {
  const m = meter();
  m.createUpDownCounter("agent.active_runs").add(-1);
  m.createCounter("agent.runs").add(1, { outcome });
  m.createHistogram("agent.run.duration", { unit: "ms" }).record(durationMs, {
    model_provider: resolveModelProvider(),
    outcome,
  });
}

export function recordStreamEvent(eventType: string): void {
  meter().createCounter("agent.stream.events").add(1, { event_type: eventType });
}

export function setIdentityAttributes(
  span: Span,
  identity: ExecutionIdentity,
  sessionId: string,
  runId: string,
): void {
  span.setAttribute("tenant.id", identity.tenantId);
  span.setAttribute("user.id", identity.userId);
  span.setAttribute("session.id", sessionId);
  span.setAttribute("run.id", runId);
}

export function setOutcomeAttribute(span: Span, outcome: RunOutcome): void {
  span.setAttribute("run.outcome", outcome);
}

export function markSuccess(span: Span): void {
  span.setStatus({ code: SpanStatusCode.OK });
  setOutcomeAttribute(span, "success");
}

export function markFailure(span: Span): void {
  setOutcomeAttribute(span, "failure");
}

export function markError(span: Span, error: unknown): void {
  span.recordException(error instanceof Error ? error : new Error(String(error)));
  span.setStatus({ code: SpanStatusCode.ERROR });
  setOutcomeAttribute(span, "error");
}

export function markCancelled(span: Span): void {
  span.addEvent("cancelled");
  setOutcomeAttribute(span, "cancelled");
}

export type { Context, Span };
export { context, trace };
