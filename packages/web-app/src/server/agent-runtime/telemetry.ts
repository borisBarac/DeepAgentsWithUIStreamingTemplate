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

export const TELEMETRY_NAME = "deep-agent-template/web-app";

const W3C = new W3CTraceContextPropagator();

export function getTracer(): Tracer {
  return trace.getTracer(TELEMETRY_NAME);
}

export function extractActiveContext(): Context {
  return context.active();
}

// Inject the currently active trace context into a serializable W3C carrier so
// a future remote executor can continue the trace.
export function injectTraceContext(): TraceContextCarrier {
  const carrier: Record<string, string> = {};
  W3C.inject(context.active(), carrier, defaultTextMapSetter);
  const traceparent = carrier.traceparent;
  if (!traceparent) return {};
  const tracestate = carrier.tracestate;
  return tracestate ? { traceparent, tracestate } : { traceparent };
}

// Restore a parent context from a W3C carrier. Falls back to the active
// context when no carrier is present.
export function extractTraceContext(carrier: TraceContextCarrier): Context {
  const bag: Record<string, string> = {};
  if (carrier.traceparent) bag.traceparent = carrier.traceparent;
  if (carrier.tracestate) bag.tracestate = carrier.tracestate;
  if (!bag.traceparent) return context.active();
  return W3C.extract(context.active(), bag, defaultTextMapGetter);
}

// Instruments are created on demand from the global meter. The meter caches
// instruments by name internally, so repeated calls are cheap and always bind
// to the currently registered meter provider.
function meter() {
  return metrics.getMeter(TELEMETRY_NAME, "0.1.0");
}

// Bounded set of model provider labels to keep metric cardinality low.
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

// Full request lifecycle duration: from the moment the runner starts until the
// turn is committed/preserved and the handle resolves.
export function recordRequestDuration(durationMs: number): void {
  meter().createHistogram("agent.request.duration", { unit: "ms" }).record(durationMs);
}

export function recordStreamEvent(eventType: string): void {
  meter().createCounter("agent.stream.events").add(1, { event_type: eventType });
}

// Span attribute helpers. Only metadata is recorded: never prompts, messages,
// outputs, memory contents, generated UI payloads, API keys, or auth data.
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

// Set terminal status + outcome attribute without an exception object. Used on
// aggregate spans whose child spans already recorded any exception details.
export function setOutcome(span: Span, outcome: RunOutcome): void {
  setOutcomeAttribute(span, outcome);
  if (outcome === "success") span.setStatus({ code: SpanStatusCode.OK });
  else if (outcome === "error") span.setStatus({ code: SpanStatusCode.ERROR });
  // "failure" and "cancelled" remain unset: not OK, not a generic error.
}

export function markSuccess(span: Span): void {
  span.setStatus({ code: SpanStatusCode.OK });
  setOutcomeAttribute(span, "success");
}

// A completed run that produced invalid output. Recorded as a normal outcome,
// not an exception.
export function markFailure(span: Span): void {
  setOutcomeAttribute(span, "failure");
}

// An unexpected thrown error: mark the owning span as errored.
export function markError(span: Span, error: unknown): void {
  span.recordException(error instanceof Error ? error : new Error(String(error)));
  span.setStatus({ code: SpanStatusCode.ERROR });
  setOutcomeAttribute(span, "error");
}

// Cancellation is recorded as a distinct outcome, never as a generic error, so
// the span status stays unset rather than ERROR.
export function markCancelled(span: Span): void {
  span.addEvent("cancelled");
  setOutcomeAttribute(span, "cancelled");
}

export type { Context, Span };
export { context, trace };
