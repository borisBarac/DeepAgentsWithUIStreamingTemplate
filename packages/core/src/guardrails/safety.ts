import { AIMessage, createMiddleware } from "langchain";
import OpenAI from "openai";

import { getLatestHumanMessageText, type AgentStateLike } from "./state.ts";
import {
  type DeepAgentMiddleware,
  type GuardrailSafetyOptions,
  type OpenAIContentSafetyClient,
} from "./types.ts";

export const DEFAULT_SAFETY_GUARDRAIL_NAME = "OpenAIContentSafetyGuardrail";
export const DEFAULT_OPENAI_MODERATION_MODEL = "omni-moderation-latest";

const refusal = (reason: string): AIMessage =>
  new AIMessage(`I cannot help with that request because it failed a guardrail check: ${reason}.`);

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

export function createSafetyGuardrail(options: GuardrailSafetyOptions = {}): DeepAgentMiddleware {
  return contentSafetyGuardrail(options.openai, {
    model: options.model,
  });
}
