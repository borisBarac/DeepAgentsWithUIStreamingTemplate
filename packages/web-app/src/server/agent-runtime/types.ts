import type {
  AgentInputMessage,
  InteractionStreamFailure,
  ModelUiOutput,
  UiUpdate,
} from "@deep-agent-template/core/interaction-stream";

export type ExecutionIdentity = {
  readonly tenantId: string;
  readonly userId: string;
};

export type ExecutionOptions = {
  readonly includeActivity: boolean;
  readonly requireStructuredOutput: boolean;
};

// W3C trace-context carrier. Serialized into ExecutionRequest so a future
// remote executor (separate process/container) can continue the same trace.
export type TraceContextCarrier = {
  readonly traceparent?: string;
  readonly tracestate?: string;
};

export type ExecutionRequest = {
  readonly identity: ExecutionIdentity;
  readonly sessionId: string;
  readonly runId: string;
  readonly messages: readonly AgentInputMessage[];
  readonly options: ExecutionOptions;
  readonly traceContext: TraceContextCarrier;
};

export type RunOutcome = "success" | "failure" | "cancelled" | "error";

export type ExecutionResult = {
  readonly outcome: RunOutcome;
  readonly failure: InteractionStreamFailure | null;
  readonly history: readonly unknown[];
  readonly structuredOutput: ModelUiOutput | null;
  readonly finalText: string;
};

// Internal event envelope. UI updates are relayed to the wire unchanged;
// lifecycle/result events drive state commits, telemetry, and cancellation.
export type ExecutionEvent =
  | { readonly kind: "ui"; readonly update: UiUpdate }
  | { readonly kind: "lifecycle"; readonly phase: "started" | "completed" | "cancelled" }
  | { readonly kind: "result"; readonly result: ExecutionResult };

// Handle returned by an executor for a single agent turn. `events` streams UI
// updates and lifecycle/result events; `result` resolves with the terminal
// outcome. The shape is preserved so a future remote executor can project the
// same stream over a transport without changing the runner.
export type AgentExecutionHandle = {
  readonly events: AsyncIterable<ExecutionEvent>;
  readonly result: Promise<ExecutionResult>;
};

export type SessionRecord = {
  readonly failure: InteractionStreamFailure | null;
  readonly history: readonly unknown[];
  readonly structuredOutput: ModelUiOutput | null;
};

export type RunMetadata = {
  readonly runId: string;
  readonly outcome: RunOutcome;
  readonly startedAt: number;
  readonly finishedAt: number;
};

// Session state store. Session state is keyed by the full
// (tenant, user, session) tuple so two guests never collide even if they
// happen to choose the same sessionId. The protocol is async so a durable
// backend (Redis/DB) can round-trip without blocking the event loop; the
// in-process adapter resolves synchronously behind the same Promise shape.
//
// Versioning: loadSession returns the current version alongside the record.
// commitSession accepts the previously loaded version and persists only when
// that version still matches (optimistic concurrency). A commit may resolve
// to `false` to signal that the session was modified concurrently; callers
// that need to retry must reload and re-apply. The in-memory adapter models
// this with a monotonically increasing per-session counter.
export type LoadedSession = {
  readonly record: SessionRecord | null;
  readonly version: number;
};

export type SessionStore = {
  loadSession(identity: ExecutionIdentity, sessionId: string): Promise<LoadedSession>;
  commitSession(
    identity: ExecutionIdentity,
    sessionId: string,
    record: SessionRecord,
    expectedVersion: number,
  ): Promise<boolean>;
  recordRun(identity: ExecutionIdentity, sessionId: string, metadata: RunMetadata): Promise<void>;
  lastRun(identity: ExecutionIdentity, sessionId: string): Promise<RunMetadata | null>;
};

// Executes a single agent turn. Implemented by BullMqAgentExecutor (serializes
// ExecutionRequest over BullMQ, projects AgentExecutionHandle over a Redis
// Stream, runs the turn in a worker process). The interface is the seam so the
// route is agnostic to how the turn runs.
export type AgentExecutor = {
  execute(
    request: ExecutionRequest,
    signal: AbortSignal,
  ): AgentExecutionHandle | Promise<AgentExecutionHandle>;
};
