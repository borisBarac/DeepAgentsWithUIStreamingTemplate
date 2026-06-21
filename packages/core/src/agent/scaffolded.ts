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
    middleware,
    modelRuntime,
    permissions,
    permissionOptions,
    promptLoader = DEFAULT_PROMPT_LOADER,
    subagents,
    subagentOverrides,
    systemPrompt,
    clarificationOptions,
    ...agentOptions
  } = options;

  const scaffold = createRuntimeScaffold({
    backend,
    backendOptions,
    clarificationOptions,
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

export function createBasicAgent(options: CreateScaffoldedAgentOptions): DeepAgent {
  return createScaffoldedAgent(options);
}
