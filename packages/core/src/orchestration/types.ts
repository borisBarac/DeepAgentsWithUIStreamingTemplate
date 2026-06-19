import type { ClarificationConfig, ClarificationState } from "../clarification/index.ts";
import type {
  CreateGuardrailDecisionOptions,
  TaskScopeDecision,
  TaskScopeGatekeeperOptions,
} from "../guardrails/index.ts";
import type {
  CreateChatModelOptions,
  ModelIdentifier,
  ModelRuntime,
  ModelRuntimeOptions,
  OpenRouterModelOptions,
} from "../models/index.ts";
import type { PromptLoader } from "../prompts/index.ts";
import type { ReviewConfig, ReviewState } from "../review/index.ts";

export type OrchestratedDeepAgentRoute =
  | "clarify"
  | "research"
  | "code"
  | "final"
  | "blocked"
  | "end";

export type OrchestratedDeepAgentErrorCategory =
  | "model"
  | "tool"
  | "permission"
  | "validation"
  | "host"
  | "unknown";

export type OrchestratedDeepAgentError = {
  node: string;
  category: OrchestratedDeepAgentErrorCategory;
  message: string;
  retryCount: number;
  required: boolean;
};

export type OrchestratedDeepAgentMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type OrchestratedDeepAgentState = {
  task: string;
  messages: OrchestratedDeepAgentMessage[];
  gatekeeperDecision?: TaskScopeDecision;
  clarification?: ClarificationState;
  researchResult?: string;
  codeResult?: string;
  finalAnswer?: string;
  review?: ReviewState;
  next: OrchestratedDeepAgentRoute;
  errors: OrchestratedDeepAgentError[];
};

export type OrchestratedDeepAgentInvokeInput = {
  messages: OrchestratedDeepAgentMessage[];
};

export type OrchestratedDeepAgentInvokeOutput = {
  messages: OrchestratedDeepAgentMessage[];
};

export type OrchestratedDeepAgentRole = "researcher" | "coder" | "finalizer" | "reviewer";

export type OrchestratedDeepAgent = {
  invoke(input: OrchestratedDeepAgentInvokeInput): Promise<OrchestratedDeepAgentInvokeOutput>;
};

export type OrchestratedDeepAgentRoutingOptions = {
  enableResearch?: boolean;
  enableCoding?: boolean;
};

export type CreateOrchestratedDeepAgentGraphOptions = CreateChatModelOptions &
  ModelRuntimeOptions & {
    agents?: Partial<Record<OrchestratedDeepAgentRole, OrchestratedDeepAgent>>;
    routing?: OrchestratedDeepAgentRoutingOptions;
    gatekeeper?: false | TaskScopeGatekeeperOptions;
    clarification?: Partial<ClarificationConfig>;
    guardrails?: false | CreateGuardrailDecisionOptions;
    review?: Partial<ReviewConfig>;
    promptLoader?: PromptLoader;
  };

export type OrchestratedDeepAgentDefaults = Partial<
  Record<OrchestratedDeepAgentRole, OrchestratedDeepAgent>
>;

export type OrchestratedDeepAgentModelContext = {
  model?: ModelIdentifier;
  modelRuntime?: ModelRuntime;
  openRouter?: OpenRouterModelOptions;
};
