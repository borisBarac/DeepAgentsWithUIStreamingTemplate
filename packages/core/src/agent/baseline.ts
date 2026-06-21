import { createDeepAgent, type DeepAgent } from "deepagents";

import { createGuardrailDecision } from "../guardrails/index.ts";
import { configureLangSmithTracing } from "../observability/index.ts";
import { DEFAULT_PROMPT_LOADER } from "../prompts/index.ts";
import { DEFAULT_AGENT_NAME } from "./constants.ts";
import type { CreateBaselineAgentOptions } from "./types.ts";

export function createBaselineAgent(options: CreateBaselineAgentOptions): DeepAgent {
  const {
    guardrails,
    langSmith,
    middleware,
    modelRuntime,
    promptLoader = DEFAULT_PROMPT_LOADER,
    ...agentOptions
  } = options;

  configureLangSmithTracing(langSmith);
  const chatModel = modelRuntime.getModelForRole("baseline");
  const guardrailDecision = createGuardrailDecision(
    guardrails === false
      ? { enabled: false, middleware }
      : { ...guardrails, taskScopeModel: chatModel, middleware },
  );

  return createDeepAgent({
    name: DEFAULT_AGENT_NAME,
    ...agentOptions,
    systemPrompt: promptLoader.getBaselinePrompt(),
    middleware: guardrailDecision.middleware,
    model: chatModel,
  });
}
