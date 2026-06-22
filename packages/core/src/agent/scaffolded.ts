import { InMemoryStore } from "@langchain/langgraph";
import { createDeepAgent, type DeepAgent } from "deepagents";

import { createGuardrailDecision } from "../guardrails/index.ts";
import { configureLangSmithTracing } from "../observability/index.ts";
import { DEFAULT_PROMPT_LOADER } from "../prompts/index.ts";
import { createRuntimeScaffold } from "../scaffold/index.ts";
import { DEFAULT_AGENT_NAME } from "./constants.ts";
import type { CreateScaffoldedAgentOptions } from "./types.ts";

export function createScaffoldedAgent(options: CreateScaffoldedAgentOptions): DeepAgent {
  const {
    backend,
    backendOptions,
    guardrails,
    interruptOn,
    langSmith,
    memory,
    memoryUserId,
    middleware,
    imageGenerationService,
    modelRuntime,
    permissions,
    permissionOptions,
    promptLoader = DEFAULT_PROMPT_LOADER,
    subagents,
    subagentOverrides,
    systemPrompt,
    clarificationOptions,
    store = new InMemoryStore(),
    ...agentOptions
  } = options;

  if (!modelRuntime) {
    throw new Error(
      "createScaffoldedAgent requires a modelRuntime. Provide one via createModelRuntime(...).",
    );
  }
  const scaffold = createRuntimeScaffold({
    backend,
    backendOptions: {
      ...backendOptions,
      memoryStore: backendOptions?.memoryStore ?? store,
      memoryUserId: memoryUserId ?? backendOptions?.memoryUserId,
    },
    clarificationOptions,
    imageGenerationService,
    interruptOn,
    memory,
    modelRuntime,
    permissions,
    permissionOptions,
    promptLoader,
    subagents,
    systemPrompt,
    ...subagentOverrides,
  });

  configureLangSmithTracing(langSmith);
  const chatModel = modelRuntime.getModelForRole("supervisor");
  const guardrailDecision = createGuardrailDecision(
    guardrails === false
      ? { enabled: false, middleware }
      : { ...guardrails, taskScopeModel: chatModel, middleware },
  );

  return createDeepAgent({
    name: DEFAULT_AGENT_NAME,
    store,
    systemPrompt: scaffold.systemPrompt,
    backend: scaffold.backend,
    interruptOn: scaffold.interruptOn,
    memory: scaffold.memory,
    permissions: scaffold.permissions,
    subagents: scaffold.subagents,
    ...agentOptions,
    middleware: guardrailDecision.middleware,
    model: chatModel,
  });
}
