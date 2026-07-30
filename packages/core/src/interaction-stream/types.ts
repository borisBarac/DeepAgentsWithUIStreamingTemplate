import type {
  A2UIValidationError,
  ClassifiedUpdates,
  ModelUiOutput,
  UiUpdate,
} from "../generative-ui/index.ts";

export type { A2UIValidationError, ClassifiedUpdates, ModelUiOutput, UiUpdate };

export type AgentInputMessage = {
  additional_kwargs?: Record<string, unknown>;
  content: string;
  role: "assistant" | "user";
};

export type AgentResult = {
  messages?: unknown[];
  structuredResponse?: unknown;
  workResult?: unknown;
};

type StreamTextMessage = {
  text: AsyncIterable<string>;
};

export type StreamSubagent = {
  name?: unknown;
  subagentName?: unknown;
  taskInput?: unknown;
  messages?: AsyncIterable<StreamTextMessage>;
  output?: Promise<unknown>;
};

export type StreamableAgent = {
  invoke: (input: { messages: AgentInputMessage[] }) => Promise<unknown>;
  streamEvents?: (
    input: { messages: AgentInputMessage[] },
    config: { configurable: { thread_id: string }; version: "v3" },
  ) => Promise<{
    messages: AsyncIterable<StreamTextMessage>;
    subagents?: AsyncIterable<StreamSubagent>;
    output: Promise<AgentResult>;
  }>;
};

export type InteractionStreamOptions = {
  agent: StreamableAgent;
  includeActivity?: boolean;
  messages: AgentInputMessage[];
  requireStructuredOutput?: boolean;
  sessionId: string;
};

export type InteractionStreamResult = {
  failure: InteractionStreamFailure | null;
  finalText: string;
  history: unknown[];
  result: AgentResult | null;
  structuredOutput: ModelUiOutput | null;
};

export type InteractionStreamFailure = {
  attempts: number;
  code: "invalid_model_output" | "invalid_ui_spec";
  issues: A2UIValidationError[];
};

export type InteractionStream = {
  result: Promise<InteractionStreamResult>;
  updates: AsyncIterable<UiUpdate>;
};

export type Attempt = {
  finalText: string;
  result: AgentResult | null;
  classification: ClassifiedUpdates;
  hasStructuredResponse: boolean;
  structuredOutput: ModelUiOutput | null;
};
