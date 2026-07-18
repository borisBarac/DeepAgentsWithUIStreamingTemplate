import { CORE_PROMPT_TEMPLATES } from "../prompts/index.ts";
import { catalogPrompt } from "./prompt-from-catalog.ts";

/** The model-facing versioned JSON object contract. */
export const GENERATIVE_UI_JSON_OBJECT_PROMPT = CORE_PROMPT_TEMPLATES.generativeUiJsonObject;

/**
 * Composes the full generative-UI prompt fragment: the core JSON object contract
 * followed by the canonical catalog prompt or an explicit caller override.
 * An explicit empty override returns only the JSON object contract.
 */
export function composeGenerativeUiPrompt(catalogPromptOverride?: string): string {
  const trimmed = (catalogPromptOverride ?? catalogPrompt).trim();
  return trimmed
    ? `${GENERATIVE_UI_JSON_OBJECT_PROMPT}\n\n${trimmed}`
    : GENERATIVE_UI_JSON_OBJECT_PROMPT;
}
