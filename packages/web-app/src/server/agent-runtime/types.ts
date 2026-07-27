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
// happen to choose the same sessionId. The current implementation is
// in-process and bounded; a durable backend (Redis/DB) is future work behind
// this interface — see DeepAgentTemplate-ykgj.
export type SessionStore = {
  loadSession(identity: ExecutionIdentity, sessionId: string): SessionRecord | null;
  commitSession(identity: ExecutionIdentity, sessionId: string, record: SessionRecord): void;
  recordRun(identity: ExecutionIdentity, sessionId: string, metadata: RunMetadata): void;
  lastRun(identity: ExecutionIdentity, sessionId: string): RunMetadata | null;
};

// Executes a single agent turn. Today only the in-process InlineAgentExecutor
// implements this; the interface is the seam for a future remote executor
// (separate process/container) that would serialize ExecutionRequest and
// project AgentExecutionHandle over a transport.
export type AgentExecutor = {
  execute(
    request: ExecutionRequest,
    signal: AbortSignal,
  ): AgentExecutionHandle | Promise<AgentExecutionHandle>;
};
