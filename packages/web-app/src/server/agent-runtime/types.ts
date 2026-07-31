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

export type ExecutionEvent =
  | { readonly kind: "ui"; readonly update: UiUpdate; readonly eventId?: string }
  | { readonly kind: "lifecycle"; readonly phase: "started" | "completed" | "cancelled" }
  | { readonly kind: "result"; readonly result: ExecutionResult };

export type AgentExecutionHandle = {
  readonly events: AsyncIterable<ExecutionEvent>;
  readonly result: Promise<ExecutionResult>;
};

export type CancellationResult =
  | { readonly status: "requested" | "already_requested" }
  | { readonly status: "unknown" | "terminal" };

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

export type AgentExecutor = {
  execute(
    request: ExecutionRequest,
    signal: AbortSignal,
  ): AgentExecutionHandle | Promise<AgentExecutionHandle>;
  reattach(
    identity: ExecutionIdentity,
    sessionId: string,
    runId: string,
    afterEventId: string,
  ): AgentExecutionHandle | Promise<AgentExecutionHandle | null> | null;
  cancel(identity: ExecutionIdentity, runId: string): Promise<CancellationResult>;
};
