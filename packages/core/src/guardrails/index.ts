import type { CreateDeepAgentParams } from "deepagents";
import { AIMessage, createMiddleware } from "langchain";
import OpenAI from "openai";
import { z } from "zod";

import allowedTasksText from "../../guardrails/taskScope.allowedTasks.md" with { type: "text" };
import disallowedTasksText from "../../guardrails/taskScope.disallowedTasks.md" with { type: "text" };
import requiredContextText from "../../guardrails/taskScope.requiredContext.md" with { type: "text" };

export const DEFAULT_SAFETY_GUARDRAIL_NAME = "OpenAIContentSafetyGuardrail";
export const DEFAULT_TASK_SCOPE_GUARDRAIL_NAME = "TaskScopeGuardrailMiddleware";
export const DEFAULT_OPENAI_MODERATION_MODEL = "omni-moderation-latest";
export const DEFAULT_GUARDRAIL_REFUSAL =
  "I cannot help with that request. Please rephrase it within the project scope and safety policy.";

export type DeepAgentMiddleware = NonNullable<CreateDeepAgentParams["middleware"]>[number];

export type TaskScopePolicyBundle = {
  requiredContext: string;
  allowedTasks: string;
  disallowedTasks: string;
};

export interface GuardrailPolicyLoader {
  getRequiredContextPolicy(): string;
  getAllowedTasksPolicy(): string;
  getDisallowedTasksPolicy(): string;
}

export class MarkdownGuardrailPolicyLoader implements GuardrailPolicyLoader {
  getRequiredContextPolicy(): string {
    return requiredContextText;
  }

  getAllowedTasksPolicy(): string {
    return allowedTasksText;
  }

  getDisallowedTasksPolicy(): string {
    return disallowedTasksText;
  }
}

export const DEFAULT_GUARDRAIL_POLICY_LOADER = new MarkdownGuardrailPolicyLoader();

export const taskScopeDecisionSchema = z.object({
  inScope: z.boolean(),
  missingContext: z.array(z.string()).default([]),
  violatedRules: z.array(z.string()).default([]),
  reason: z.string(),
});

export type TaskScopeDecision = z.infer<typeof taskScopeDecisionSchema>;

export type TaskScopeClassifier = {
  invoke(input: unknown): Promise<unknown>;
};

export type StructuredTaskScopeModel = {
  withStructuredOutput(schema: unknown, options?: { name?: string }): TaskScopeClassifier;
};

export type OpenAIContentSafetyClient = Pick<OpenAI, "moderations">;

export type GuardrailSafetyOptions = {
  model?: string;
  openai?: OpenAIContentSafetyClient;
};

export type GuardrailTaskScopeOptions = {
  classifier?: TaskScopeClassifier;
  model?: StructuredTaskScopeModel;
  policies?: Partial<TaskScopePolicyBundle>;
  refusalMessage?: string;
};

export type CreateGuardrailDecisionOptions = {
  enabled?: boolean;
  middleware?: CreateDeepAgentParams["middleware"];
  policyLoader?: GuardrailPolicyLoader;
  safety?: false | GuardrailSafetyOptions;
  taskScopeModel?: StructuredTaskScopeModel;
  taskScope?: false | GuardrailTaskScopeOptions;
};

export type GuardrailDecisionRuntime = {
  enabled: {
    safety: boolean;
    taskScope: boolean;
  };
  middleware: DeepAgentMiddleware[];
  policies: TaskScopePolicyBundle;
};

type MessageLike = {
  content?: unknown;
  role?: string;
  _getType?: () => string;
};

type AgentStateLike = {
  messages?: MessageLike[];
};

function contentToText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text: unknown }).text);
        }

        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  if (content == null) {
    return "";
  }

  return String(content);
}

function isHumanMessage(message: MessageLike): boolean {
  const type = message._getType?.();

  return type === "human" || message.role === "user" || message.role === "human";
}

function getLatestHumanMessageText(state: AgentStateLike): string | undefined {
  const messages = state.messages ?? [];

  for (const message of messages.toReversed()) {
    if (isHumanMessage(message)) {
      const text = contentToText(message.content).trim();

      return text.length > 0 ? text : undefined;
    }
  }

  return undefined;
}

function blockedUpdate(message: string): { messages: AIMessage[]; jumpTo: "end" } {
  return {
    messages: [new AIMessage(message)],
    jumpTo: "end",
  };
}

function refusal(reason: string): AIMessage {
  return new AIMessage(
    `I cannot help with that request because it failed a guardrail check: ${reason}.`,
  );
}

const contentSafetyGuardrail = (
  openai?: OpenAIContentSafetyClient,
  options: Pick<GuardrailSafetyOptions, "model"> = {},
): DeepAgentMiddleware =>
  createMiddleware({
    name: DEFAULT_SAFETY_GUARDRAIL_NAME,
    beforeAgent: {
      hook: async (state: AgentStateLike) => {
        const input = getLatestHumanMessageText(state);

        if (!input) {
          return;
        }

        const moderation = await (openai ?? new OpenAI()).moderations.create({
          model: options.model ?? DEFAULT_OPENAI_MODERATION_MODEL,
          input,
        });

        const result = moderation.results[0];
        if (result?.flagged) {
          return {
            messages: [refusal("unsafe content")],
            jumpTo: "end",
          };
        }

        return;
      },
      canJumpTo: ["end"],
    },
  }) as DeepAgentMiddleware;

function createSafetyGuardrail(options: GuardrailSafetyOptions = {}): DeepAgentMiddleware {
  return contentSafetyGuardrail(options.openai, {
    model: options.model,
  });
}

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

function createTaskScopeGuardrail(options: GuardrailTaskScopeOptions = {}): DeepAgentMiddleware {
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

export function createGuardrailDecision(
  options: CreateGuardrailDecisionOptions = {},
): GuardrailDecisionRuntime {
  const policyLoader = options.policyLoader ?? DEFAULT_GUARDRAIL_POLICY_LOADER;
  const taskScopeOptions = options.taskScope === false ? undefined : options.taskScope;
  const policies = {
    requiredContext:
      taskScopeOptions?.policies?.requiredContext ?? policyLoader.getRequiredContextPolicy(),
    allowedTasks: taskScopeOptions?.policies?.allowedTasks ?? policyLoader.getAllowedTasksPolicy(),
    disallowedTasks:
      taskScopeOptions?.policies?.disallowedTasks ?? policyLoader.getDisallowedTasksPolicy(),
  };

  if (options.enabled === false) {
    return {
      enabled: {
        safety: false,
        taskScope: false,
      },
      middleware: [...(options.middleware ?? [])],
      policies,
    };
  }

  const guardrails: DeepAgentMiddleware[] = [];
  const safetyEnabled = options.safety !== false;

  if (options.safety !== false) {
    guardrails.push(createSafetyGuardrail(options.safety));
  }

  const taskScopeModel = taskScopeOptions?.model ?? options.taskScopeModel;
  const taskScopeClassifier = taskScopeOptions?.classifier;
  const taskScopeEnabled =
    options.taskScope !== false && Boolean(taskScopeClassifier || taskScopeModel);

  if (taskScopeEnabled) {
    guardrails.push(
      createTaskScopeGuardrail({
        ...taskScopeOptions,
        model: taskScopeModel,
        policies,
      }),
    );
  }

  return {
    enabled: {
      safety: safetyEnabled,
      taskScope: taskScopeEnabled,
    },
    middleware: [...guardrails, ...(options.middleware ?? [])],
    policies,
  };
}
