import { AIMessage, createMiddleware } from "langchain";
import { z } from "zod";
import { CORE_PROMPT_TEMPLATES, renderPromptTemplate } from "../prompts/index.ts";

import { DEFAULT_GUARDRAIL_POLICY_LOADER, type TaskScopePolicyBundle } from "./policies.ts";
import { type AgentStateLike, getLatestHumanMessageText } from "./state.ts";
import type {
  DeepAgentMiddleware,
  GuardrailTaskScopeOptions,
  TaskScopeClassifier,
} from "./types.ts";

export const DEFAULT_TASK_SCOPE_GUARDRAIL_NAME = "TaskScopeGuardrailMiddleware";
export const DEFAULT_GUARDRAIL_REFUSAL =
  "I cannot help with that request. Please rephrase it within the project scope and safety policy.";

export const taskScopeDecisionSchema = z.object({
  inScope: z.boolean(),
  missingContext: z.array(z.string()).default([]),
  violatedRules: z.array(z.string()).default([]),
  reason: z.string().default(""),
});

export type TaskScopeDecision = z.infer<typeof taskScopeDecisionSchema>;

const blockedUpdate = (message: string): { messages: AIMessage[]; jumpTo: "end" } => ({
  messages: [new AIMessage(message)],
  jumpTo: "end",
});

export function createTaskScopePrompt(request: string, policies: TaskScopePolicyBundle): string {
  return renderPromptTemplate(CORE_PROMPT_TEMPLATES.taskScopeClassification, {
    ...policies,
    request,
  });
}

export function resolveTaskScopePolicies(
  policies: Partial<TaskScopePolicyBundle> = {},
): TaskScopePolicyBundle {
  return {
    requiredContext:
      policies.requiredContext ?? DEFAULT_GUARDRAIL_POLICY_LOADER.getRequiredContextPolicy(),
    allowedTasks: policies.allowedTasks ?? DEFAULT_GUARDRAIL_POLICY_LOADER.getAllowedTasksPolicy(),
    disallowedTasks:
      policies.disallowedTasks ?? DEFAULT_GUARDRAIL_POLICY_LOADER.getDisallowedTasksPolicy(),
  };
}

export async function classifyTaskScopeRequest(
  request: string,
  classifier: TaskScopeClassifier,
  policies: TaskScopePolicyBundle,
): Promise<TaskScopeDecision> {
  return taskScopeDecisionSchema.parse(
    await classifier.invoke([
      {
        role: "system",
        content: CORE_PROMPT_TEMPLATES.structuredJson.trim(),
      },
      {
        role: "user",
        content: createTaskScopePrompt(request, policies),
      },
    ]),
  );
}

export function createTaskScopeGuardrail(
  options: GuardrailTaskScopeOptions = {},
): DeepAgentMiddleware {
  const classifier =
    options.classifier ??
    options.model?.withStructuredOutput(taskScopeDecisionSchema, { method: "jsonMode" });

  if (!classifier) {
    throw new Error("Task scope guardrail requires a classifier or structured-output model.");
  }

  const policies = resolveTaskScopePolicies(options.policies);
  const refusalMessage = options.refusalMessage ?? DEFAULT_GUARDRAIL_REFUSAL;

  return createMiddleware({
    name: DEFAULT_TASK_SCOPE_GUARDRAIL_NAME,
    beforeAgent: {
      canJumpTo: ["end"],
      hook: async (state: AgentStateLike) => {
        const userMessage = getLatestHumanMessageText(state);

        if (!userMessage) {
          return;
        }

        const decision = await classifyTaskScopeRequest(userMessage, classifier, policies);

        if (decision.inScope) {
          return;
        }

        return blockedUpdate(refusalMessage);
      },
    },
  }) as DeepAgentMiddleware;
}
