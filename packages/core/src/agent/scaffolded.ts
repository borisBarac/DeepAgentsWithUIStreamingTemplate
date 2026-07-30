import { InMemoryStore } from "@langchain/langgraph";
import type { DeepAgent } from "deepagents";
import { DEFAULT_PROMPT_LOADER } from "../prompts/index.ts";
import { createRuntimeScaffold } from "../scaffold/index.ts";
import {
  BaseStoreWorkflowStateStore,
  createWorkflowControllerMiddleware,
} from "../workflow/index.ts";
import { createProductGateAgent } from "./product-gate.ts";
import type { WorkflowUiAgent } from "./runtime.ts";
import { createAgentFromRuntimeScaffold } from "./runtime.ts";
import type { CreateScaffoldedAgentOptions } from "./types.ts";

export function createScaffoldedAgent(
  options: CreateScaffoldedAgentOptions & {
    generativeUi: NonNullable<CreateScaffoldedAgentOptions["generativeUi"]>;
  },
): WorkflowUiAgent;
export function createScaffoldedAgent(options: CreateScaffoldedAgentOptions): DeepAgent;
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
    profile,
    promptLoader = DEFAULT_PROMPT_LOADER,
    sandboxIdentity,
    subagents,
    subagentOverrides,
    systemPrompt,
    clarificationOptions,
    reviewOptions,
    generativeUi,
    additionalResearcherTools,
    store = new InMemoryStore(),
    workflowStateStore = new BaseStoreWorkflowStateStore(store),
    workflowEnabled,
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
    sandboxIdentity,
    subagents,
    systemPrompt,
    workflowEnabled,
    ...(additionalResearcherTools ? { additionalResearcherTools } : {}),
    ...subagentOverrides,
  });

  const workflowEnabledFlag = workflowEnabled !== false;
  const workflowController = workflowEnabledFlag
    ? createWorkflowControllerMiddleware({
        maxClarificationRounds: scaffold.clarification.config.maxRounds,
        questionsPerRound: scaffold.clarification.config.questionsPerRound,
        maxReviewCycles: scaffold.review.config.maxReviewCycles,
        productGenerationEnabled: scaffold.productGeneration?.enabled === true,
        workflowStateStore,
      })
    : undefined;

  const agent = createAgentFromRuntimeScaffold({
    factoryName: "createScaffoldedAgent",
    scaffold,
    modelRuntime,
    guardrails,
    langSmith,
    profile,
    middleware: workflowController
      ? [workflowController, ...(middleware ?? [])]
      : (middleware ?? []),
    store,
    agentOptions,
  });
  if (!generativeUi) return agent;
  return createProductGateAgent({
    mainAgent: agent,
    casualModel: modelRuntime.getModelForCategory("fast"),
    classifierModel: modelRuntime.getModelForCategory("fast"),
    workflowController,
  }) as WorkflowUiAgent;
}
