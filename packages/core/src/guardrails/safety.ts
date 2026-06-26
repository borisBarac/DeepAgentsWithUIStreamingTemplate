import { AIMessage, createMiddleware } from "langchain";
import { z } from "zod";

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
  return [
    "You are a content-safety classifier. Decide whether the user request is unsafe.",
    "Flag a request when it solicits, describes, or facilitates genuinely harmful content,",
    "such as hate, harassment, violence, self-harm, sexual content involving minors, or",
    "illegal activity. Do not flag ordinary software-engineering or research requests.",
    "",
    "Return only the requested structured decision as a JSON object.",
    "",
    "User request:",
    request,
  ].join("\n");
}

export async function classifySafetyRequest(
  request: string,
  classifier: SafetyClassifier,
): Promise<SafetyDecision> {
  return safetyDecisionSchema.parse(
    await classifier.invoke([
      {
        role: "system",
        content:
          "You are a strict content-safety classifier. Return only the requested structured decision as a JSON object.",
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
