import { AIMessage, createMiddleware } from "langchain";
import { z } from "zod";
import { CORE_PROMPT_TEMPLATES, renderPromptTemplate } from "../prompts/index.ts";

import { type AgentStateLike, getLatestHumanMessageText } from "./state.ts";
import type { DeepAgentMiddleware, GuardrailSafetyOptions, SafetyClassifier } from "./types.ts";

export const DEFAULT_SAFETY_GUARDRAIL_NAME = "ContentSafetyGuardrail";

export const DEFAULT_SAFETY_REFUSAL =
  "I cannot help with that request because it failed a safety check.";

export const safetyDecisionSchema = z.object({
  flagged: z.boolean(),
  categories: z.array(z.string()).default([]),
  reason: z.string(),
});

export type SafetyDecision = z.infer<typeof safetyDecisionSchema>;

const refusal = (reason: string): AIMessage =>
  new AIMessage(`I cannot help with that request because it failed a guardrail check: ${reason}.`);

export function createSafetyPrompt(request: string): string {
  return renderPromptTemplate(CORE_PROMPT_TEMPLATES.safetyClassification, { request });
}

export async function classifySafetyRequest(
  request: string,
  classifier: SafetyClassifier,
): Promise<SafetyDecision> {
  return safetyDecisionSchema.parse(
    await classifier.invoke([
      {
        role: "system",
        content: CORE_PROMPT_TEMPLATES.structuredJson.trim(),
      },
      {
        role: "user",
        content: createSafetyPrompt(request),
      },
    ]),
  );
}

export function createSafetyGuardrail(options: GuardrailSafetyOptions = {}): DeepAgentMiddleware {
  const classifier =
    options.classifier ??
    options.model?.withStructuredOutput(safetyDecisionSchema, { method: "jsonMode" });

  if (!classifier) {
    throw new Error("Safety guardrail requires a classifier or structured-output model.");
  }

  const refusalMessage = options.refusalMessage ?? DEFAULT_SAFETY_REFUSAL;

  return createMiddleware({
    name: DEFAULT_SAFETY_GUARDRAIL_NAME,
    beforeAgent: {
      hook: async (state: AgentStateLike) => {
        const input = getLatestHumanMessageText(state);

        if (!input) {
          return;
        }

        const decision = await classifySafetyRequest(input, classifier);

        if (decision.flagged) {
          return {
            messages: [refusal(decision.reason || refusalMessage)],
            jumpTo: "end",
          };
        }

        return;
      },
      canJumpTo: ["end"],
    },
  }) as DeepAgentMiddleware;
}
