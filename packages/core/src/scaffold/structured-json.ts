import { HumanMessage } from "@langchain/core/messages";
import { type AgentMiddleware, StructuredOutputParsingError } from "langchain";

import { CORE_PROMPT_TEMPLATES, renderPromptTemplate } from "../prompts/index.ts";

export const STRUCTURED_JSON_MIDDLEWARE_NAME = "ScaffoldStructuredJsonObject";

export type StructuredJsonMiddlewareOptions = {
  retryOnParsingError?: boolean;
};

export function hasStructuredOutputParsingCause(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current = error;
  while (current != null && !seen.has(current)) {
    if (current instanceof StructuredOutputParsingError) return true;
    seen.add(current);
    if (typeof current !== "object" || !("cause" in current)) return false;
    current = current.cause;
  }
  return false;
}

/**
 * Forces provider-native JSON object mode while keeping schema validation local.
 * The optional retry is for isolated subagents. The supervisor leaves retries
 * to the interaction processor.
 */
export function createStructuredJsonMiddleware(
  schema: unknown,
  options: StructuredJsonMiddlewareOptions = {},
): AgentMiddleware {
  return {
    name: STRUCTURED_JSON_MIDDLEWARE_NAME,
    wrapModelCall: async (request, handler) => {
      const rawModelSettings = (request.modelSettings ?? {}) as Record<string, unknown>;
      const {
        outputConfig: _outputConfig,
        responseSchema: _responseSchema,
        ls_structured_output_format: _langSmithStructuredOutput,
        strict: _strict,
        ...modelSettings
      } = rawModelSettings;
      const enforcedRequest = {
        ...request,
        toolChoice: undefined,
        modelSettings: {
          ...modelSettings,
          response_format: { type: "json_object" },
          outputConfig: undefined,
          responseSchema: undefined,
          ls_structured_output_format: undefined,
          strict: undefined,
        },
      };

      try {
        return await handler(enforcedRequest);
      } catch (error) {
        if (!options.retryOnParsingError || !hasStructuredOutputParsingCause(error)) {
          throw error;
        }

        return handler({
          ...enforcedRequest,
          messages: [
            ...request.messages,
            new HumanMessage(
              renderPromptTemplate(CORE_PROMPT_TEMPLATES.structuredJsonCorrection, {
                schema: JSON.stringify(schema),
              }).trim(),
            ),
          ],
        });
      }
    },
  };
}

/** Adds the word JSON, which some JSON object mode providers require. */
export function withStructuredJsonPrompt(prompt: string): string {
  return `${prompt}\n\n${CORE_PROMPT_TEMPLATES.structuredJson.trim()}`;
}
