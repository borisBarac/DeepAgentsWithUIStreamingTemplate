import type { CreateDeepAgentParams, HarnessProfileOptions } from "deepagents";

import type { GenerativeUiOptions } from "../generative-ui/index.ts";
import type { CreateGuardrailDecisionOptions } from "../guardrails/index.ts";
import type { ModelRuntimeOptions } from "../models/index.ts";
import type { LangSmithTracingOptions } from "../observability/index.ts";
import type { PromptLoader } from "../prompts/index.ts";
import type { CreateRuntimeScaffoldOptions } from "../scaffold/index.ts";
import type { WorkflowStateStore } from "../workflow/index.ts";

type DeepAgentScaffoldOptions = Pick<
  CreateDeepAgentParams,
  | "backend"
  | "checkpointer"
  | "interruptOn"
  | "memory"
  | "middleware"
  | "permissions"
  | "responseFormat"
  | "skills"
  | "store"
  | "streamTransformers"
  | "subagents"
  | "tools"
>;

/**
 * Re-exported from the generative-ui module so the public agent API keeps a
 * stable import path for `GenerativeUiOptions`.
 */
export type { GenerativeUiOptions } from "../generative-ui/index.ts";

export type CreateScaffoldedAgentOptions = Omit<
  DeepAgentScaffoldOptions,
  "backend" | "interruptOn" | "permissions" | "subagents"
> &
  ModelRuntimeOptions & {
    guardrails?: false | CreateGuardrailDecisionOptions;
    name?: string;
    promptLoader?: PromptLoader;
    langSmith?: LangSmithTracingOptions;
    generativeUi?: GenerativeUiOptions;
    /**
     * Harness profile overrides merged on top of
     * {@link DEFAULT_AGENT_PROFILE} and registered globally under the
     * `"openai"` key before `createDeepAgent` is called. Scalars in the
     * caller's profile replace defaults.
     *
     * Note: deepagents' resolver always lands on the bare `"openai"` key for
     * our `ChatOpenAI` instances, so the harness profile is effectively
     * app-wide. For per-role shaping, use `subagentOverrides` instead.
     */
    profile?: HarnessProfileOptions;
  } & Omit<
    CreateRuntimeScaffoldOptions,
    "promptLoader" | "researcher" | "analyst" | "reviewer" | "clarifier" | "imageDesigner"
  > & {
    memoryUserId?: string;
    subagentOverrides?: Pick<
      CreateRuntimeScaffoldOptions,
      "researcher" | "analyst" | "reviewer" | "clarifier" | "imageDesigner"
    >;
    /**
     * Workflow state store shared across controller rebuilds. When omitted the
     * controller allocates its own {@link InMemoryWorkflowStateStore}, which
     * is scoped to a single controller instance.
     */
    workflowStateStore?: WorkflowStateStore;
  };
