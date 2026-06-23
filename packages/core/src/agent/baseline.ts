import { InMemoryStore } from "@langchain/langgraph";
import { createDeepAgent, type DeepAgent } from "deepagents";
import { composeGenerativeUiPrompt } from "../generative-ui/prompt.ts";
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
    store = new InMemoryStore(),
    generativeUi,
    ...agentOptions
  } = options;

  if (!modelRuntime) {
    throw new Error(
      "createBaselineAgent requires a modelRuntime. Provide one via createModelRuntime(...).",
    );
  }

  configureLangSmithTracing(langSmith);
  const chatModel = modelRuntime.getModelForRole("baseline");
  const guardrailDecision = createGuardrailDecision(
    guardrails === false
      ? { enabled: false, middleware }
      : { ...guardrails, taskScopeModel: chatModel, middleware },
  );

  const baselinePrompt = promptLoader.getBaselinePrompt();
  const systemPrompt = generativeUi
    ? `${baselinePrompt}\n\n${composeGenerativeUiPrompt(generativeUi.catalogPrompt)}`
    : baselinePrompt;

  return createDeepAgent({
    name: DEFAULT_AGENT_NAME,
    ...agentOptions,
    store,
    systemPrompt,
    middleware: guardrailDecision.middleware,
    model: chatModel,
  });
}
