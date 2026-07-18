import { z } from "zod";
import type { StructuredOutputMethod } from "../models/types.ts";
import {
  CORE_PROMPT_TEMPLATES,
  type PromptLoader,
  renderPromptTemplate,
} from "../prompts/index.ts";
import type { ClarificationSkipReason } from "./types.ts";

/**
 * Zod schema for the triage classifier's structured output. The classifier
 * decides whether the full clarifier subagent round is needed for a given
 * user message.
 *
 * - `skip`    — the request is self-contained or is a continuation/answer;
 *               advance straight to execution without invoking the clarifier.
 * - `proceed` — the request has material ambiguity; route through the
 *               clarifier subagent as usual.
 */
export const clarificationTriageDecisionSchema = z.object({
  decision: z.enum(["skip", "proceed"]),
  reason: z.string().trim().min(1),
});

export type ClarificationTriageDecision = z.infer<typeof clarificationTriageDecisionSchema>;

/**
 * Classifier interface consumed by the workflow controller. Mirrors the
 * {@link SafetyClassifier} shape: a single `invoke` returning structured JSON.
 */
export type ClarificationTriageClassifier = {
  invoke(input: unknown): Promise<unknown>;
};

/**
 * A model that supports `withStructuredOutput`, suitable for building a triage
 * classifier when no explicit {@link ClarificationTriageClassifier} is supplied.
 * Mirrors `StructuredSafetyModel` in `guardrails/types.ts`.
 */
export type StructuredClarificationTriageModel = {
  withStructuredOutput(
    schema: unknown,
    options?: { method?: StructuredOutputMethod },
  ): ClarificationTriageClassifier;
};

/**
 * The skip-reason tag recorded on the synthetic clarification result when the
 * triage classifier short-circuits the clarifier round.
 */
export const TRIAGE_SKIP_REASON: ClarificationSkipReason = "triage_classifier";

/**
 * Safe default returned when no classifier can be constructed. Always proceeds
 * through the clarifier — never silently skips.
 */
export const PROCEED_TRIAGE_DECISION: ClarificationTriageDecision = Object.freeze({
  decision: "proceed",
  reason: "No triage classifier configured; falling back to full clarification.",
});

const INLINE_FALLBACK_TRIAGE_PROMPT = [
  "You are a strict pre-clarification triage classifier.",
  "",
  "Decide whether the latest user message needs the full clarifier round before execution.",
  'Return a JSON object with two fields: decision (either "skip" or "proceed") and reason (one short sentence).',
  "",
  'Return decision: "skip" for self-contained requests, continuation/acknowledgment tokens',
  "(continue, yes, ok, go ahead, retry, do it), direct answers to prior clarifier questions,",
  "trivial factual prompts, and single-shot creative requests with no external constraints.",
  "",
  'Return decision: "proceed" for ambiguous requests, multi-step builds with unstated scope,',
  'and the start of any new top-level task. When unsure, prefer "proceed".',
  "",
  "Return only the requested structured decision as a JSON object.",
  "",
  "Latest user message:",
  "{{request}}",
].join("\n");

/**
 * Composes the user-facing prompt fed to the triage classifier. Uses the
 * `clarification-triage.md` template via the loader when available, else falls
 * back to an inline template.
 */
export function createClarificationTriagePrompt(
  request: string,
  promptLoader?: PromptLoader,
): string {
  const template =
    promptLoader && typeof promptLoader.getClarificationTriagePrompt === "function"
      ? promptLoader.getClarificationTriagePrompt()
      : INLINE_FALLBACK_TRIAGE_PROMPT;
  return renderPromptTemplate(template, { request });
}

/**
 * Runs the triage classifier against a single user message and parses its
 * structured output. Throws if the classifier returns a non-conforming payload.
 */
export async function classifyClarificationTriage(
  request: string,
  classifier: ClarificationTriageClassifier,
  promptLoader?: PromptLoader,
): Promise<ClarificationTriageDecision> {
  const prompt = createClarificationTriagePrompt(request, promptLoader);
  return clarificationTriageDecisionSchema.parse(
    await classifier.invoke([
      { role: "system", content: CORE_PROMPT_TEMPLATES.structuredJson.trim() },
      { role: "user", content: prompt },
    ]),
  );
}

export type ClarificationTriageClassifierOptions = {
  classifier?: ClarificationTriageClassifier;
  model?: StructuredClarificationTriageModel;
  promptLoader?: PromptLoader;
};

/**
 * Constructs the classifier used by the workflow controller. Resolution order:
 *
 * 1. Explicit `classifier` override.
 * 2. `model.withStructuredOutput(schema, { method: "jsonMode" })` — matches the
 *    guardrail pattern. Works with DeepSeek provided the prompt contains the
 *    word "json" (the structured-json system message ensures this).
 * 3. Returns `undefined` if neither is supplied — callers should then fall
 *    back to the legacy always-clarify behavior.
 */
export function createClarificationTriageClassifier(
  options: ClarificationTriageClassifierOptions = {},
): ClarificationTriageClassifier | undefined {
  if (options.classifier) {
    return options.classifier;
  }
  if (options.model) {
    return options.model.withStructuredOutput(clarificationTriageDecisionSchema, {
      method: "jsonMode",
    });
  }
  return undefined;
}
