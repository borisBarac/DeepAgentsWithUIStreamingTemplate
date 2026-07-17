import type { CreateDeepAgentParams } from "deepagents";

import type { GenerativeUiOptions } from "../generative-ui/index.ts";
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
  } & Omit<
    CreateRuntimeScaffoldOptions,
    | "promptLoader"
    | "researcher"
    | "analyst"
    | "reviewer"
    | "clarifier"
    | "imageDesigner"
    | "productGenerator"
  > & {
    memoryUserId?: string;
    subagentOverrides?: Pick<
      CreateRuntimeScaffoldOptions,
      "researcher" | "analyst" | "reviewer" | "clarifier" | "imageDesigner" | "productGenerator"
    >;
  };
