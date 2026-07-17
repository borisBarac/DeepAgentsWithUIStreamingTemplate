import { InMemoryStore } from "@langchain/langgraph";
import type { DeepAgent } from "deepagents";
import { DEFAULT_PROMPT_LOADER } from "../prompts/index.ts";
import { createRuntimeScaffold } from "../scaffold/index.ts";
import { createWorkflowControllerMiddleware } from "../workflow/index.ts";
import { createAgentFromRuntimeScaffold } from "./runtime.ts";
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
    reviewOptions,
    generativeUi,
    store = new InMemoryStore(),
    ...agentOptions
  } = options;

  const scaffold = createRuntimeScaffold({
    backend,
    backendOptions: {
      ...backendOptions,
      memoryStore: backendOptions?.memoryStore ?? store,
      memoryUserId: memoryUserId ?? backendOptions?.memoryUserId,
    },
    clarificationOptions,
    reviewOptions,
    generativeUi,
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

  const workflowController = createWorkflowControllerMiddleware({
    maxClarificationRounds: scaffold.clarification.config.maxRounds,
    questionsPerRound: scaffold.clarification.config.questionsPerRound,
    maxRevisions: scaffold.review.config.maxRevisions,
    generativeUiEnabled: scaffold.productGeneration.enabled,
  });

  return createAgentFromRuntimeScaffold({
    factoryName: "createScaffoldedAgent",
    scaffold,
    modelRuntime,
    guardrails,
    langSmith,
    middleware: [workflowController, ...(middleware ?? [])],
    store,
    agentOptions,
  });
}
