/**
 * The NDJSON framing portion of the generative-UI prompt.
 *
 * Core owns this because it owns the {@link UiUpdate} protocol: it tells the
 * model to stream newline-delimited JSON objects — one update per line. It
 * deliberately does NOT describe the spec format or allowed components — that
 * is catalog-specific and belongs to the caller (passed as `catalogPrompt` to
 * {@link composeGenerativeUiPrompt}).
 *
 * No `response_format: { type: "json_object" }` is required: the model emits
 * raw NDJSON and the server frames it line-by-line via `StreamingLineBuffer`.
 */
export const GENERATIVE_UI_NDJSON_PROMPT = `Respond using newline-delimited JSON (NDJSON): emit one JSON object per line, each followed by a newline. Do NOT wrap the output in Markdown fences or prose.

Each line must be exactly one of:
- {"type":"message","text":"short assistant message"}
- {"type":"question","question":{"id":"stable-question-id","prompt":"question text","kind":"multiple_choice","options":["option 1","option 2"]}}
- {"type":"question","question":{"id":"stable-question-id","prompt":"question text","kind":"open_text","placeholder":"optional placeholder"}}
- {"type":"ui","spec":<JsonRenderSpec>}
- {"type":"error","message":"short error message"}

Use question updates only when the user must answer before useful product details can be generated.
Prefer streaming several small updates: a short message line, then either a question line or one ui line.`;

/**
 * The product-card catalog fragment. Describes the `product-card` json-render
 * component that streamed product details must use, plus the multi-product
 * streaming rule. Core-owned because the product-card component contract is
 * part of the product-generator scaffold, not the caller's app catalog.
 */
export const PRODUCT_CARD_CATALOG_PROMPT = `Product details stream as "product-card" ui specs. Emit one ui update per product card:

{"type":"ui","spec":{"root":"<unique-card-id>","elements":{"<unique-card-id>":{"type":"product-card","props":{"id":"<unique-card-id>","title":"<concise title>","description":"<clear description>","imageUrl":"<optional https url>"}}}}}

Product-card rules:
- Each card needs a unique id, a concise title, and a clear description.
- imageUrl is optional. Omit it (rendering a placeholder) until a real image is available.
- Stream multiple products as separate ui lines, sequentially, so the interaction zone renders them incrementally.
- Product cards belong only in the ui stream. Never put product details in message or question lines.
- Clarification questions belong only in question lines (routed to the chat history), never in ui specs.`;

/**
 * Composes the full generative-UI prompt fragment: the core NDJSON framing
 * followed by the caller's catalog prompt (which defines `<JsonRenderSpec>`
 * and the allowed components). When `catalogPrompt` is omitted or empty, only
 * the NDJSON framing is returned.
 *
 * {@link createBaselineAgent} appends this to the baseline system prompt when
 * its `generativeUi` option is set.
 */
export function composeGenerativeUiPrompt(catalogPrompt?: string): string {
  const trimmed = catalogPrompt?.trim();
  return trimmed ? `${GENERATIVE_UI_NDJSON_PROMPT}\n\n${trimmed}` : GENERATIVE_UI_NDJSON_PROMPT;
}

/**
 * Composes the generative-UI prompt for the product-generator context: the core
 * NDJSON framing, the product-card catalog (always included), and an optional
 * caller-provided catalog for any additional app components.
 *
 * {@link createRuntimeScaffold} appends this to the supervisor system prompt
 * when its `generativeUi` option is enabled.
 */
export function composeProductGeneratorPrompt(catalogPrompt?: string): string {
  const sections = [GENERATIVE_UI_NDJSON_PROMPT, PRODUCT_CARD_CATALOG_PROMPT];
  const trimmed = catalogPrompt?.trim();
  if (trimmed) {
    sections.push(trimmed);
  }
  return sections.join("\n\n");
}
