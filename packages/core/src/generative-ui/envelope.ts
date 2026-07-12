import type { Spec } from "@json-render/core";
import { z } from "zod";

import type { ClarificationResult } from "../clarification/index.ts";
import type {
  ProductCard,
  ProductCardBatch,
  UiQuestion,
  UiQuestionOption,
  UiUpdate,
  UiZone,
} from "./types.ts";

const rawMessageUpdateSchema = z.object({
  type: z.literal("message"),
  text: z.string(),
});

/**
 * Accepts either a plain string or a structured option object so catalogs that
 * only need simple labels keep working, while the clarifier's richer
 * `{label, description, recommended}` options survive the stream intact.
 */
const uiQuestionOptionSchema = z.union([
  z.string().min(1),
  z.object({
    label: z.string().min(1),
    description: z.string().optional(),
    recommended: z.boolean().optional(),
  }),
]);

const rawQuestionUpdateSchema = z.object({
  type: z.literal("question"),
  question: z.discriminatedUnion("kind", [
    z.object({
      id: z.string().min(1),
      prompt: z.string().min(1),
      kind: z.literal("multiple_choice"),
      options: z.array(uiQuestionOptionSchema).min(2).max(4),
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

const rawMainAgentActivityUpdateSchema = z.object({
  type: z.literal("main_agent_activity"),
  event: z.enum(["started", "delta", "completed", "error"]),
  text: z.string().optional(),
  message: z.string().optional(),
});

const rawSubagentActivityUpdateSchema = z.object({
  type: z.literal("subagent_activity"),
  subagentRunId: z.string().min(1).optional(),
  subagentName: z.string().min(1),
  event: z.enum(["started", "delta", "completed", "error"]),
  task: z.string().optional(),
  text: z.string().optional(),
  message: z.string().optional(),
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
  rawMainAgentActivityUpdateSchema,
  rawSubagentActivityUpdateSchema,
]);

/**
 * The json-render component type used for streamed product cards.
 */
export const PRODUCT_CARD_COMPONENT_NAME = "product-card";

/**
 * Validates a single product card's props.
 */
export const productCardSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  imageUrl: z.string().url().optional(),
  status: z.enum(["streaming", "complete"]).optional(),
});

/**
 * Validates a batch of product cards returned by a product-generator specialist.
 */
export const productCardBatchSchema = z.object({
  products: z.array(productCardSchema).min(1),
}) satisfies z.ZodType<ProductCardBatch>;

/**
 * A `question` {@link UiUpdate}, extracted for converters and handlers.
 */
export type QuestionUpdate = Extract<UiUpdate, { type: "question" }>;

/**
 * A `ui` {@link UiUpdate}, extracted for converters.
 */
export type UiSpecUpdate = Extract<UiUpdate, { type: "ui" }>;

/**
 * Validates a streamed spec against a component catalog. Consumers that own a
 * catalog (e.g. a `json-render` catalog) pass this into {@link normalizeUiUpdate}
 * so catalog-specific validation stays out of the core protocol layer.
 */
export type NormalizeSpec = (spec: unknown) => Spec | null;

/**
 * A single structured diagnostic for a rejected UI spec.
 */
export type SpecValidationIssue = {
  path: string;
  code: string;
  message: string;
};

/**
 * Result of validating a UI spec: either a normalized spec or a list of
 * structured issues describing why it was rejected.
 */
export type SpecValidationResult =
  | { ok: true; spec: Spec }
  | { ok: false; issues: SpecValidationIssue[] };

/**
 * Diagnostic validator for a UI spec. Produces structured issues on failure so
 * the agent can be told exactly what to fix. Preferred over {@link NormalizeSpec}
 * when both are supplied to an interaction stream.
 */
export type ValidateSpec = (spec: unknown) => SpecValidationResult;

/**
 * Adapts a legacy {@link NormalizeSpec} into a {@link ValidateSpec}, producing a
 * generic issue when the spec is rejected (since the legacy callback gives no
 * detail).
 */
export function normalizeSpecToValidateSpec(normalize: NormalizeSpec): ValidateSpec {
  return (spec) => {
    const result = normalize(spec);
    return result
      ? { ok: true, spec: result }
      : {
          ok: false,
          issues: [
            {
              path: "$",
              code: "invalid_spec",
              message: "The spec was rejected by the catalog validator.",
            },
          ],
        };
  };
}

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
  onQuestion?: (question: UiQuestion) => void;
  onSpec: (spec: Spec) => void;
  onError: (message: string) => void;
  onMainAgentActivity?: (update: Extract<UiUpdate, { type: "main_agent_activity" }>) => void;
  onSubagentActivity?: (update: Extract<UiUpdate, { type: "subagent_activity" }>) => void;
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
    case "main_agent_activity":
      handlers.onMainAgentActivity?.(update);
      break;
    case "subagent_activity":
      handlers.onSubagentActivity?.(update);
      break;
  }
}

/**
 * Returns the UI zone an update belongs to.
 *
 * `ui` updates (product cards) and agent activity route to the dedicated
 * interaction zone; chat content stays in the transcript.
 */
export function uiUpdateZone(update: UiUpdate): UiZone {
  return update.type === "ui" ||
    update.type === "main_agent_activity" ||
    update.type === "subagent_activity"
    ? "interaction"
    : "chat";
}

/**
 * Normalizes a {@link UiQuestionOption} (which may be a plain string or a
 * structured object) into a stable `{label, description?, recommended?}` shape
 * so renderers handle both wire forms uniformly.
 */
export function normalizeQuestionOption(option: UiQuestionOption): {
  label: string;
  description?: string;
  recommended?: boolean;
} {
  if (typeof option === "string") {
    return { label: option };
  }

  const normalized: { label: string; description?: string; recommended?: boolean } = {
    label: option.label,
  };
  if (option.description) {
    normalized.description = option.description;
  }
  if (option.recommended) {
    normalized.recommended = option.recommended;
  }
  return normalized;
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
 * Validates a streamed spec as a single product-card component and returns it
 * unchanged when valid, or `null` otherwise.
 *
 * Use as a {@link NormalizeSpec} to restrict a stream to product cards:
 *
 * ```ts
 * normalizeUiUpdate(line, normalizeProductCardSpec);
 * ```
 */
export function normalizeProductCardSpec(spec: unknown): Spec | null {
  if (!spec || typeof spec !== "object") {
    return null;
  }

  const candidate = spec as Spec;
  if (
    typeof candidate.root !== "string" ||
    candidate.root === "" ||
    !candidate.elements ||
    typeof candidate.elements !== "object"
  ) {
    return null;
  }

  const rootElement = candidate.elements[candidate.root];
  if (!rootElement || rootElement.type !== PRODUCT_CARD_COMPONENT_NAME) {
    return null;
  }

  const parsed = productCardSchema.safeParse(rootElement.props);
  return parsed.success ? (candidate as Spec) : null;
}

/**
 * Converts a clarifier {@link ClarificationResult} into streamed `question`
 * updates. Questions with options become multiple-choice updates (preserving
 * label/description/recommended); questions without options become open-text.
 *
 * Returns an empty array unless the result still needs clarification.
 */
export function clarificationResultToQuestionUpdates(
  result: ClarificationResult,
): QuestionUpdate[] {
  if (result.status !== "needs_clarification") {
    return [];
  }

  return result.questions.map((question) => {
    const options = question.options ?? [];
    if (options.length > 0) {
      return {
        type: "question",
        question: {
          id: question.id,
          prompt: question.question,
          kind: "multiple_choice",
          options: options.map((option) => {
            const structured: {
              label: string;
              description?: string;
              recommended?: boolean;
            } = { label: option.label };
            if (option.description) {
              structured.description = option.description;
            }
            if (option.recommended) {
              structured.recommended = option.recommended;
            }
            return structured;
          }) satisfies UiQuestionOption[],
        },
      };
    }

    return {
      type: "question",
      question: {
        id: question.id,
        prompt: question.question,
        kind: "open_text",
      },
    };
  });
}

/**
 * Wraps each product card as a separate `ui` update carrying a json-render spec
 * rooted at a single `product-card` element. Streaming one update per card lets
 * the interaction zone render cards incrementally.
 */
export function productCardsToUiUpdates(cards: readonly ProductCard[]): UiSpecUpdate[] {
  return cards.map((card) => {
    const props: Record<string, unknown> = {
      id: card.id,
      title: card.title,
      description: card.description,
    };
    if (card.imageUrl) {
      props.imageUrl = card.imageUrl;
    }
    if (card.status) {
      props.status = card.status;
    }

    return {
      type: "ui",
      spec: {
        root: card.id,
        elements: {
          [card.id]: {
            type: PRODUCT_CARD_COMPONENT_NAME,
            props,
          },
        },
      },
    };
  });
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
 * A UI candidate line that failed validation, retained so the interaction stream
 * can request a targeted repair from the agent.
 */
export type RejectedUiCandidate = {
  line: string;
  issues: SpecValidationIssue[];
};

/**
 * The outcome of classifying a block of streamed NDJSON text: updates that are
 * safe to emit immediately, and UI candidates that were rejected (for repair).
 */
export type ClassifiedUpdates = {
  accepted: UiUpdate[];
  rejectedUiCandidates: RejectedUiCandidate[];
};

/**
 * Classifies each attempted NDJSON line into accepted updates, rejected UI
 * candidates, or irrelevant malformed output (silently dropped).
 *
 * A line is treated as a UI candidate when it parses as a `type: "ui"`
 * envelope, or when it clearly intends to be one (a malformed envelope that
 * still carries a UI type/spec, or unparseable text mentioning `type: "ui"`).
 * Rejected candidates carry structured issues from `validateSpec` so a repair
 * pass can give the agent path-specific feedback.
 */
export function classifyUpdateText(text: string, validateSpec?: ValidateSpec): ClassifiedUpdates {
  const accepted: UiUpdate[] = [];
  const rejectedUiCandidates: RejectedUiCandidate[] = [];

  const classify = (candidate: unknown, line: string): void => {
    const envelope = rawUpdateSchema.safeParse(candidate);
    if (envelope.success) {
      if (envelope.data.type !== "ui") {
        accepted.push(envelope.data);
        return;
      }
      if (!validateSpec) {
        accepted.push({ type: "ui", spec: envelope.data.spec as Spec });
        return;
      }
      const result = validateSpec(envelope.data.spec);
      if (result.ok) {
        accepted.push({ type: "ui", spec: result.spec });
      } else {
        rejectedUiCandidates.push({ line, issues: result.issues });
      }
      return;
    }

    if (looksLikeUiCandidate(candidate)) {
      rejectedUiCandidates.push({
        line,
        issues: issuesForMalformedCandidate(candidate, validateSpec),
      });
    }
  };

  const visitParsed = (parsed: unknown): void => {
    for (const candidate of extractUpdateObjects(parsed)) {
      classify(candidate, JSON.stringify(candidate));
    }
  };

  const trimmed = text.trim();
  if (trimmed) {
    try {
      visitParsed(JSON.parse(trimmed));
      return { accepted, rejectedUiCandidates };
    } catch {
      // Not a single JSON value; parse line by line below.
    }
  }

  for (const line of text.split("\n")) {
    const lineTrimmed = line.trim();
    if (!lineTrimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(lineTrimmed);
    } catch {
      if (looksLikeUiText(lineTrimmed)) {
        rejectedUiCandidates.push({
          line: lineTrimmed,
          issues: [
            {
              path: "$",
              code: "invalid_json",
              message: "This line is not valid JSON.",
            },
          ],
        });
      }
      continue;
    }
    classify(parsed, lineTrimmed);
  }

  return { accepted, rejectedUiCandidates };
}

function looksLikeUiCandidate(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.type === "ui") {
    return true;
  }
  if (record.spec !== undefined && typeof record.spec === "object" && record.spec !== null) {
    const spec = record.spec as Record<string, unknown>;
    if (typeof spec.root === "string" || spec.elements !== undefined) {
      return true;
    }
  }
  return false;
}

function looksLikeUiText(line: string): boolean {
  if (/"type"\s*:\s*"ui"/.test(line)) {
    return true;
  }
  return /"spec"\s*:/.test(line) && /"(root|elements)"/.test(line);
}

function issuesForMalformedCandidate(
  candidate: unknown,
  validateSpec?: ValidateSpec,
): SpecValidationIssue[] {
  if (validateSpec && typeof candidate === "object" && candidate !== null && "spec" in candidate) {
    const specValue = (candidate as { spec: unknown }).spec;
    if (typeof specValue === "object" && specValue !== null) {
      const result = validateSpec(specValue);
      if (!result.ok) {
        return result.issues;
      }
    }
  }
  return [
    {
      path: "$",
      code: "invalid_envelope",
      message: "This line is not a valid UI update.",
    },
  ];
}

/**
 * Parses a complete NDJSON text into validated {@link UiUpdate}s.
 *
 * Used for the non-streaming fallback path. Each line is JSON-parsed and run
 * through {@link normalizeUiUpdate}; blank lines and malformed JSON are skipped.
 */
export function parseUpdateText(text: string, normalizeSpec?: NormalizeSpec): UiUpdate[] {
  const validateSpec = normalizeSpec ? normalizeSpecToValidateSpec(normalizeSpec) : undefined;
  return classifyUpdateText(text, validateSpec).accepted;
}
