import type { Spec } from "@json-render/core";
import { z } from "zod";

import type { UiUpdate } from "./types.ts";

const rawMessageUpdateSchema = z.object({
  type: z.literal("message"),
  text: z.string(),
});

const rawQuestionUpdateSchema = z.object({
  type: z.literal("question"),
  question: z.discriminatedUnion("kind", [
    z.object({
      id: z.string().min(1),
      prompt: z.string().min(1),
      kind: z.literal("multiple_choice"),
      options: z.array(z.string().min(1)).min(2).max(4),
    }),
    z.object({
      id: z.string().min(1),
      prompt: z.string().min(1),
      kind: z.literal("open_text"),
      placeholder: z.string().optional(),
    }),
  ]),
});

const rawErrorUpdateSchema = z.object({
  type: z.literal("error"),
  message: z.string(),
});

const rawUiUpdateSchema = z.object({
  type: z.literal("ui"),
  spec: z.unknown(),
});

const rawUpdateSchema = z.discriminatedUnion("type", [
  rawMessageUpdateSchema,
  rawQuestionUpdateSchema,
  rawUiUpdateSchema,
  rawErrorUpdateSchema,
]);

/**
 * Validates a streamed spec against a component catalog. Consumers that own a
 * catalog (e.g. a `json-render` catalog) pass this into {@link normalizeUiUpdate}
 * so catalog-specific validation stays out of the core protocol layer.
 */
export type NormalizeSpec = (spec: unknown) => Spec | null;

/**
 * Parses a single NDJSON line into a {@link UiUpdate}.
 *
 * Returns `null` for malformed JSON or unknown update types so a bad line never
 * aborts the stream.
 */
export function parseUpdateLine(line: string): UiUpdate | null {
  try {
    return normalizeUiUpdate(JSON.parse(line));
  } catch {
    return null;
  }
}

export type UpdateHandlers = {
  onMessage: (text: string) => void;
  onQuestion?: (question: Extract<UiUpdate, { type: "question" }>["question"]) => void;
  onSpec: (spec: Spec) => void;
  onError: (message: string) => void;
};

/**
 * Routes a {@link UiUpdate} to the matching handler.
 */
export function applyUiUpdate(update: UiUpdate, handlers: UpdateHandlers): void {
  switch (update.type) {
    case "message":
      handlers.onMessage(update.text);
      break;
    case "question":
      handlers.onQuestion?.(update.question);
      break;
    case "ui":
      handlers.onSpec(update.spec);
      break;
    case "error":
      handlers.onError(update.message);
      break;
  }
}

/**
 * Validates a raw streamed object into a {@link UiUpdate}.
 *
 * The envelope shape (message/ui/error) is always validated. For `ui` updates,
 * the spec is passed through `normalizeSpec` when provided so the caller can
 * enforce its own component catalog. Without a `normalizeSpec`, the spec is
 * passed through unchanged (useful for tests and catalog-agnostic consumers).
 *
 * Returns `null` when the value is not a valid update, or when a provided
 * `normalizeSpec` rejects the spec.
 */
export function normalizeUiUpdate(value: unknown, normalizeSpec?: NormalizeSpec): UiUpdate | null {
  const parsed = rawUpdateSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }

  if (parsed.data.type !== "ui") {
    return parsed.data;
  }

  const spec = normalizeSpec ? normalizeSpec(parsed.data.spec) : (parsed.data.spec as Spec);
  return spec ? { type: "ui", spec } : null;
}

/**
 * Unwraps alternative JSON shapes a model might emit instead of bare NDJSON
 * objects, so a single parser path handles all of them.
 *
 * - A bare object (the expected NDJSON shape) is returned as a single-element
 *   array, leaving shape validation to {@link normalizeUiUpdate}.
 * - A JSON array is returned as-is (each element validated downstream).
 * - A wrapper like `{"updates":[...]}` or `{"results":[...]}` is unwrapped to
 *   its inner array.
 *
 * This keeps streaming resilient when the model occasionally ignores the NDJSON
 * prompt and emits an array or envelope instead of one-object-per-line.
 */
export function extractUpdateObjects(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed !== null && typeof parsed === "object" && !("type" in parsed)) {
    const candidates = parsed as Record<string, unknown>;
    if (Array.isArray(candidates.updates)) return candidates.updates;
    if (Array.isArray(candidates.results)) return candidates.results;
  }
  return [parsed];
}

/**
 * Incremental NDJSON line framer. Buffers streamed text and yields each
 * complete line (split on `\n`) the moment its trailing newline arrives.
 *
 * The model streams token-by-token; this replaces the old bracket-depth
 * `UiUpdateScanner` now that the model emits raw NDJSON instead of a
 * `{"updates":[...]}` envelope. Pair with {@link parseUpdateLine} (or
 * {@link normalizeUiUpdate}) to turn each line into a {@link UiUpdate}.
 *
 * The final line of a stream often arrives without a trailing newline, so
 * call {@link flush} once the stream ends to emit any remaining buffered text.
 */
export class StreamingLineBuffer {
  #tail = "";

  push(chunk: string): string[] {
    const parts = (this.#tail + chunk).split("\n");
    this.#tail = parts.pop() ?? "";
    return parts;
  }

  /**
   * Emits any buffered text that has not yet been terminated by a newline.
   * Call once the stream has ended. Returns an empty array if nothing is
   * buffered; resets the buffer so a second call is a no-op.
   */
  flush(): string[] {
    if (this.#tail === "") return [];
    const tail = this.#tail;
    this.#tail = "";
    return [tail];
  }
}

/**
 * Parses a complete NDJSON text into validated {@link UiUpdate}s.
 *
 * Used for the non-streaming fallback path. Each line is JSON-parsed and run
 * through {@link normalizeUiUpdate}; blank lines and malformed JSON are skipped.
 */
export function parseUpdateText(text: string, normalizeSpec?: NormalizeSpec): UiUpdate[] {
  const updates: UiUpdate[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    for (const candidate of extractUpdateObjects(parsed)) {
      const update = normalizeUiUpdate(candidate, normalizeSpec);
      if (update) updates.push(update);
    }
  }
  return updates;
}
