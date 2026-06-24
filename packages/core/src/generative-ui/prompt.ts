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
 * Composes the full generative-UI prompt fragment: the core NDJSON framing
 * followed by the caller's catalog prompt (which defines `<JsonRenderSpec>`
 * and the allowed components).
 *
 * {@link createBaselineAgent} appends this to the baseline system prompt when
 * its `generativeUi` option is set.
 */
export function composeGenerativeUiPrompt(catalogPrompt: string): string {
  return `${GENERATIVE_UI_NDJSON_PROMPT}\n\n${catalogPrompt}`;
}
