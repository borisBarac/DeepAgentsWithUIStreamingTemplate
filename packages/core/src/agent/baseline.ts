import { InMemoryStore } from "@langchain/langgraph";
import type { DeepAgent } from "deepagents";
import { DEFAULT_PROMPT_LOADER } from "../prompts/index.ts";
import { createRuntimeScaffold } from "../scaffold/index.ts";
import { createAgentFromRuntimeScaffold } from "./runtime.ts";
import type { CreateBaselineAgentOptions } from "./types.ts";

export function createBaselineAgent(options: CreateBaselineAgentOptions): DeepAgent {
  const {
    backend,
    guardrails,
    interruptOn,
    langSmith,
    memory,
    middleware,
    modelRuntime,
    permissions,
    promptLoader = DEFAULT_PROMPT_LOADER,
    subagents,
    store = new InMemoryStore(),
    generativeUi,
    ...agentOptions
  } = options;

  const scaffold = createRuntimeScaffold({
    mode: "baseline",
    backend,
    generativeUi,
    interruptOn,
    memory,
    permissions,
    promptLoader,
    subagents,
  });

  return createAgentFromRuntimeScaffold({
    factoryName: "createBaselineAgent",
    scaffold,
    modelRuntime,
    guardrails,
    langSmith,
    middleware,
    store,
    agentOptions,
  });
}
