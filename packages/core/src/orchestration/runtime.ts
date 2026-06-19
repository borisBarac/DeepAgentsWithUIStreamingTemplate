import { createBaselineAgent } from "../agent/baseline.ts";
import type { ClarificationConfig } from "../clarification/index.ts";
import type { CreateGuardrailDecisionOptions, TaskScopeGatekeeper } from "../guardrails/index.ts";
import type { ModelRuntime } from "../models/index.ts";
import type { PromptLoader } from "../prompts/index.ts";
import type { ReviewConfig } from "../review/index.ts";
import { missingAgentError, toStructuredError } from "./errors.ts";
import { adaptDeepAgent, extractStageOutput } from "./messages.ts";
import type { OrchestratedGraphState } from "./state.ts";
import type {
  OrchestratedDeepAgent,
  OrchestratedDeepAgentError,
  OrchestratedDeepAgentMessage,
  OrchestratedDeepAgentRole,
  OrchestratedDeepAgentRoute,
  OrchestratedDeepAgentRoutingOptions,
} from "./types.ts";

type MessageContextItem = { content?: string; label: string };

export type NodeContext = {
  agents: Partial<Record<OrchestratedDeepAgentRole, OrchestratedDeepAgent>>;
  routing: OrchestratedDeepAgentRoutingOptions;
  gatekeeper?: TaskScopeGatekeeper;
  clarification: Partial<ClarificationConfig>;
  guardrails: false | CreateGuardrailDecisionOptions;
  review: ReviewConfig;
  promptLoader: PromptLoader;
  modelRuntime?: ModelRuntime;
  defaults: Partial<Record<OrchestratedDeepAgentRole, OrchestratedDeepAgent>>;
};

export type StageRunResult = {
  output?: string;
  next: OrchestratedDeepAgentRoute;
  errors?: OrchestratedDeepAgentError[];
};

function modelRuntimeForRole(
  modelRuntime: ModelRuntime,
  role: OrchestratedDeepAgentRole,
): ModelRuntime {
  return {
    getModel: (profile) => modelRuntime.getModel(profile),
    getModelForRole: () => modelRuntime.getModelForRole(role),
  };
}

function rolePromptForRole(role: OrchestratedDeepAgentRole, promptLoader: PromptLoader): string {
  switch (role) {
    case "researcher":
      return promptLoader.getResearcherPrompt();
    case "reviewer":
      return promptLoader.getReviewAgentPrompt();
    default:
      return promptLoader.getBaselinePrompt();
  }
}

function rolePromptLoader(role: OrchestratedDeepAgentRole, base: PromptLoader): PromptLoader {
  const prompt = rolePromptForRole(role, base);
  return {
    getBaselinePrompt: () => prompt,
    getSupervisorPrompt: base.getSupervisorPrompt.bind(base),
    getClarifierPrompt: base.getClarifierPrompt.bind(base),
    getResearcherPrompt: base.getResearcherPrompt.bind(base),
    getAnalystPrompt: base.getAnalystPrompt.bind(base),
    getReviewAgentPrompt: base.getReviewAgentPrompt.bind(base),
  };
}

export function resolveAgent(
  ctx: NodeContext,
  role: OrchestratedDeepAgentRole,
): OrchestratedDeepAgent | undefined {
  const injected = ctx.agents[role];
  if (injected) {
    return injected;
  }
  const cached = ctx.defaults[role];
  if (cached) {
    return cached;
  }
  if (ctx.modelRuntime === undefined) {
    return undefined;
  }
  const built = adaptDeepAgent(
    createBaselineAgent({
      modelRuntime: ctx.modelRuntime ? modelRuntimeForRole(ctx.modelRuntime, role) : undefined,
      guardrails: ctx.guardrails,
      promptLoader: rolePromptLoader(role, ctx.promptLoader),
    }),
  );
  ctx.defaults[role] = built;
  return built;
}

function contextItemsForState(
  state: OrchestratedGraphState,
  role: OrchestratedDeepAgentRole,
): MessageContextItem[] {
  const answers = state.clarification?.answeredInformation ?? [];
  const sharedContext: MessageContextItem[] = [
    {
      content:
        answers.length > 0
          ? answers.map((answer) => `- ${answer.key}: ${answer.value}`).join("\n")
          : undefined,
      label: "Clarifications provided",
    },
    {
      content:
        state.errors.length > 0
          ? state.errors
              .map((entry) => `- [${entry.category}] ${entry.node}: ${entry.message}`)
              .join("\n")
          : undefined,
      label: "Known limitations",
    },
  ];
  const stageContextByRole: Record<OrchestratedDeepAgentRole, MessageContextItem[]> = {
    researcher: [{ content: state.codeResult, label: "Prior implementation notes" }],
    coder: [{ content: state.researchResult, label: "Prior research" }],
    finalizer: [],
    reviewer: [],
  };
  return [...sharedContext, ...stageContextByRole[role]];
}

export function buildStageMessages(
  state: OrchestratedGraphState,
  role: OrchestratedDeepAgentRole,
  instruction: string,
): OrchestratedDeepAgentMessage[] {
  const messages: OrchestratedDeepAgentMessage[] = [];
  for (const context of contextItemsForState(state, role)) {
    if (context.content) {
      messages.push({
        role: "system",
        content: `${context.label}:\n${context.content}`,
      });
    }
  }
  messages.push(...(state.messages ?? []));
  messages.push({ role: "user", content: `${instruction}\n\nTask: ${state.task}` });
  return messages;
}

export async function runStageAgent(
  state: OrchestratedGraphState,
  ctx: NodeContext,
  role: OrchestratedDeepAgentRole,
  instruction: string,
  options: { required: boolean; successRoute: import("./types.ts").OrchestratedDeepAgentRoute },
): Promise<StageRunResult> {
  const agent = resolveAgent(ctx, role);
  if (!agent) {
    return {
      next: options.required ? "blocked" : options.successRoute,
      errors: [missingAgentError(role, options.required)],
    };
  }
  try {
    const result = await agent.invoke({ messages: buildStageMessages(state, role, instruction) });
    return {
      output: extractStageOutput(result.messages),
      next: options.successRoute,
    };
  } catch (error) {
    return {
      next: options.required ? "blocked" : options.successRoute,
      errors: [toStructuredError(error, role, { required: options.required })],
    };
  }
}
