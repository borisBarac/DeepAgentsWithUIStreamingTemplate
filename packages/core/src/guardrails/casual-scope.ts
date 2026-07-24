import { AIMessage, createMiddleware } from "langchain";
import { z } from "zod";
import { CORE_PROMPT_TEMPLATES, renderPromptTemplate } from "../prompts/index.ts";

import { type AgentStateLike, getLatestHumanMessageText } from "./state.ts";
import type {
  DeepAgentMiddleware,
  GuardrailTaskScopeOptions,
  TaskScopeClassifier,
} from "./types.ts";

export const DEFAULT_CASUAL_SCOPE_GUARDRAIL_NAME = "CasualScopeGuardrail";

export const DEFAULT_CASUAL_REFUSAL =
  "I can't help with that here. This system is an autonomous product designer and builder — it turns a product idea into a complete, reviewed product concept (research, design, generation, and revision). I'm only able to handle quick greetings and simple questions. If you have a product idea you'd like to explore, let me know.";

export const casualScopeDecisionSchema = z.object({
  allow: z.boolean(),
  reason: z.string(),
});

export type CasualScopeDecision = z.infer<typeof casualScopeDecisionSchema>;

const blockedUpdate = (message: string): { messages: AIMessage[]; jumpTo: "end" } => ({
  messages: [new AIMessage(message)],
  jumpTo: "end",
});

export function createCasualScopePrompt(request: string): string {
  return renderPromptTemplate(CORE_PROMPT_TEMPLATES.casualScopeClassification, { request });
}

export async function classifyCasualScopeRequest(
  request: string,
  classifier: TaskScopeClassifier,
): Promise<CasualScopeDecision> {
  return casualScopeDecisionSchema.parse(
    await classifier.invoke([
      {
        role: "system",
        content: CORE_PROMPT_TEMPLATES.structuredJson.trim(),
      },
      {
        role: "user",
        content: createCasualScopePrompt(request),
      },
    ]),
  );
}

export function createCasualScopeGuardrail(
  options: GuardrailTaskScopeOptions = {},
): DeepAgentMiddleware {
  const classifier =
    options.classifier ??
    options.model?.withStructuredOutput(casualScopeDecisionSchema, { method: "jsonMode" });

  if (!classifier) {
    throw new Error("Casual scope guardrail requires a classifier or structured-output model.");
  }

  const refusalMessage = options.refusalMessage ?? DEFAULT_CASUAL_REFUSAL;

  return createMiddleware({
    name: DEFAULT_CASUAL_SCOPE_GUARDRAIL_NAME,
    beforeAgent: {
      canJumpTo: ["end"],
      hook: async (state: AgentStateLike) => {
        const userMessage = getLatestHumanMessageText(state);

        if (!userMessage) {
          return;
        }

        const decision = await classifyCasualScopeRequest(userMessage, classifier);

        if (decision.allow) {
          return;
        }

        return blockedUpdate(refusalMessage);
      },
    },
  }) as DeepAgentMiddleware;
}
