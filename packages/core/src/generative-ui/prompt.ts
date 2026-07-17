import { CORE_PROMPT_TEMPLATES } from "../prompts/index.ts";

/** The model-facing versioned JSON object contract. */
export const GENERATIVE_UI_JSON_OBJECT_PROMPT = CORE_PROMPT_TEMPLATES.generativeUiJsonObject;

/**
 * The product-card catalog fragment. Describes the `product-card` json-render
 * component that streamed product details must use, plus the multi-product
 * streaming rule. Core-owned because the product-card component contract is
 * part of the product-generator scaffold, not the caller's app catalog.
 */
export const PRODUCT_CARD_CATALOG_PROMPT = CORE_PROMPT_TEMPLATES.productCardCatalog;

/**
 * Composes the full generative-UI prompt fragment: the core JSON object contract
 * followed by the caller's catalog prompt (which defines `<JsonRenderSpec>`
 * and the allowed components). When `catalogPrompt` is omitted or empty, only
 * the JSON object contract is returned.
 */
export function composeGenerativeUiPrompt(catalogPrompt?: string): string {
  const trimmed = catalogPrompt?.trim();
  return trimmed
    ? `${GENERATIVE_UI_JSON_OBJECT_PROMPT}\n\n${trimmed}`
    : GENERATIVE_UI_JSON_OBJECT_PROMPT;
}

/**
 * Composes the generative-UI prompt for the product-generator context: the core
 * JSON object contract and the product-card catalog, plus an optional caller
 * catalog for other app components.
 *
 * {@link createRuntimeScaffold} appends this to the supervisor system prompt
 * when its `generativeUi` option is enabled.
 */
export function composeProductGeneratorPrompt(catalogPrompt?: string): string {
  const sections = [GENERATIVE_UI_JSON_OBJECT_PROMPT, PRODUCT_CARD_CATALOG_PROMPT];
  const trimmed = catalogPrompt?.trim();
  if (trimmed) {
    sections.push(trimmed);
  }
  return sections.join("\n\n");
}
