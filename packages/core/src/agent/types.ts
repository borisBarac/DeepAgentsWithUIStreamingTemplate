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

/**
 * Opt-in generative-UI support for {@link createBaselineAgent}.
 *
 * When set, the agent appends a generative-UI prompt fragment (NDJSON framing
 * + the provided `catalogPrompt`) to its system prompt so it streams one
 * `UiUpdate` per line. Parse the stream with `StreamingLineBuffer` /
 * `parseUpdateLine` (or `normalizeUiUpdate` for full validation).
 */
export type GenerativeUiOptions = {
  catalogPrompt: string;
};

export type CreateBaselineAgentOptions = DeepAgentScaffoldOptions &
  ModelRuntimeOptions & {
    guardrails?: false | CreateGuardrailDecisionOptions;
    name?: string;
    promptLoader?: PromptLoader;
    langSmith?: LangSmithTracingOptions;
    generativeUi?: GenerativeUiOptions;
  };

export type CreateScaffoldedAgentOptions = Omit<
  CreateBaselineAgentOptions,
  "backend" | "interruptOn" | "permissions" | "subagents"
> &
  Omit<
    CreateRuntimeScaffoldOptions,
    "promptLoader" | "researcher" | "analyst" | "reviewer" | "clarifier" | "imageDesigner"
  > & {
    memoryUserId?: string;
    subagentOverrides?: Pick<
      CreateRuntimeScaffoldOptions,
      "researcher" | "analyst" | "reviewer" | "clarifier" | "imageDesigner"
    >;
  };
