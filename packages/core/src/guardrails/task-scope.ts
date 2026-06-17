import { AIMessage, createMiddleware } from "langchain";
import { z } from "zod";

import { DEFAULT_GUARDRAIL_POLICY_LOADER, type TaskScopePolicyBundle } from "./policies.ts";
import { getLatestHumanMessageText, type AgentStateLike } from "./state.ts";
import { type DeepAgentMiddleware, type GuardrailTaskScopeOptions } from "./types.ts";

export const DEFAULT_TASK_SCOPE_GUARDRAIL_NAME = "TaskScopeGuardrailMiddleware";
export const DEFAULT_GUARDRAIL_REFUSAL =
  "I cannot help with that request. Please rephrase it within the project scope and safety policy.";

export const taskScopeDecisionSchema = z.object({
  inScope: z.boolean(),
  missingContext: z.array(z.string()).default([]),
  violatedRules: z.array(z.string()).default([]),
  reason: z.string(),
});

export type TaskScopeDecision = z.infer<typeof taskScopeDecisionSchema>;

const blockedUpdate = (message: string): { messages: AIMessage[]; jumpTo: "end" } => ({
  messages: [new AIMessage(message)],
  jumpTo: "end",
});

function createTaskScopePrompt(request: string, policies: TaskScopePolicyBundle): string {
  return [
    "Classify whether the user request is inside the agent's task scope.",
    "Use required context to decide whether the request needs clarification, but do not mark it out of scope solely because context is missing.",
    "Mark the request out of scope when it asks for a disallowed task or clearly falls outside the allowed task list.",
    "",
    "Required context policy:",
    policies.requiredContext,
    "",
    "Allowed tasks policy:",
    policies.allowedTasks,
    "",
    "Disallowed tasks policy:",
    policies.disallowedTasks,
    "",
    "User request:",
    request,
  ].join("\n");
}

export function createTaskScopeGuardrail(options: GuardrailTaskScopeOptions = {}): DeepAgentMiddleware {
  const classifier =
    options.classifier ??
    options.model?.withStructuredOutput(taskScopeDecisionSchema, {
      name: "task_scope_decision",
    });

  if (!classifier) {
    throw new Error("Task scope guardrail requires a classifier or structured-output model.");
  }

  const policies = {
    requiredContext:
      options.policies?.requiredContext ??
      DEFAULT_GUARDRAIL_POLICY_LOADER.getRequiredContextPolicy(),
    allowedTasks:
      options.policies?.allowedTasks ?? DEFAULT_GUARDRAIL_POLICY_LOADER.getAllowedTasksPolicy(),
    disallowedTasks:
      options.policies?.disallowedTasks ??
      DEFAULT_GUARDRAIL_POLICY_LOADER.getDisallowedTasksPolicy(),
  };
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

        const decision = taskScopeDecisionSchema.parse(
          await classifier.invoke([
            {
              role: "system",
              content:
                "You are a strict task-scope classifier. Return only the requested structured decision.",
            },
            {
              role: "user",
              content: createTaskScopePrompt(userMessage, policies),
            },
          ]),
        );

        if (decision.inScope) {
          return;
        }

        return blockedUpdate(refusalMessage);
      },
    },
  }) as DeepAgentMiddleware;
}
