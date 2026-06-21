import type { CreateDeepAgentParams } from "deepagents";

import type { CreateGuardrailDecisionOptions } from "../guardrails/index.ts";
import type { ModelRuntimeOptions } from "../models/index.ts";
import type { LangSmithTracingOptions } from "../observability/index.ts";
import type { PromptLoader } from "../prompts/index.ts";
import type { CreateRuntimeScaffoldOptions } from "../scaffold/index.ts";

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

export type CreateBaselineAgentOptions = DeepAgentScaffoldOptions &
  ModelRuntimeOptions & {
    guardrails?: false | CreateGuardrailDecisionOptions;
    name?: string;
    promptLoader?: PromptLoader;
    langSmith?: LangSmithTracingOptions;
  };

export type CreateScaffoldedAgentOptions = Omit<
  CreateBaselineAgentOptions,
  "backend" | "interruptOn" | "permissions" | "subagents"
> &
  Omit<
    CreateRuntimeScaffoldOptions,
    "promptLoader" | "researcher" | "analyst" | "reviewer" | "clarifier"
  > & {
    memoryUserId?: string;
    subagentOverrides?: Pick<
      CreateRuntimeScaffoldOptions,
      "researcher" | "analyst" | "reviewer" | "clarifier"
    >;
  };
