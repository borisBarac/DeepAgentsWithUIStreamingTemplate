import { InMemoryStore } from "@langchain/langgraph";
import type { DeepAgent } from "deepagents";
import { DEFAULT_PROMPT_LOADER } from "../prompts/index.ts";
import { createRuntimeScaffold } from "../scaffold/index.ts";
import { createWorkflowControllerMiddleware } from "../workflow/index.ts";
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
    subagents,
    subagentOverrides,
    systemPrompt,
    clarificationOptions,
    reviewOptions,
    generativeUi,
    additionalAnalystTools,
    additionalResearcherTools,
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
    ...(additionalResearcherTools ? { additionalResearcherTools } : {}),
    ...(additionalAnalystTools ? { additionalAnalystTools } : {}),
    ...subagentOverrides,
  });

  const workflowController = createWorkflowControllerMiddleware({
    maxClarificationRounds: scaffold.clarification.config.maxRounds,
    questionsPerRound: scaffold.clarification.config.questionsPerRound,
    maxReviewCycles: scaffold.review.config.maxReviewCycles,
    productGenerationEnabled: scaffold.productGeneration?.enabled === true,
  });

  const agent = createAgentFromRuntimeScaffold({
    factoryName: "createScaffoldedAgent",
    scaffold,
    modelRuntime,
    guardrails,
    langSmith,
    profile,
    middleware: [workflowController, ...(middleware ?? [])],
    store,
    agentOptions,
  });
  if (!generativeUi) return agent;
  return createProductGateAgent({
    mainAgent: agent,
    casualModel: modelRuntime.getModelForCategory("fast"),
    classifierModel: modelRuntime.getModelForCategory("fast"),
    workflowController,
    stateStore: store,
  }) as WorkflowUiAgent;
}
