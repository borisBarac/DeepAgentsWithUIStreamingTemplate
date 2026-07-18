import { z } from "zod";

export type ClarificationMode = "mandatory-preflight";
export type ClarificationQuestionsPerRound = 1 | 2 | 3;
export type ClarificationStatus = "needs_clarification" | "ready_to_proceed" | "blocked";

/**
 * Metadata indicating that a clarification result was short-circuited without
 * running the clarifier subagent. The status stays {@link ClarificationStatus}
 * (typically `ready_to_proceed`); this field is the audit trail explaining WHY.
 *
 * - `triage_classifier`: the pre-clarifier triage classifier judged the request
 *   self-contained enough to skip the clarifier round entirely.
 * - `user_command`: an explicit user flow-command (e.g. `/skip-clarify`)
 *   forced the skip. (Reserved for future use; not yet wired.)
 * - `config_disabled`: `ClarificationConfig.enabled === false` short-circuited
 *   the preflight. (Reserved for future use; not yet wired.)
 */
export type ClarificationSkipReason = "triage_classifier" | "user_command" | "config_disabled";

export type ClarificationOption = {
  label: string;
  description: string;
  recommended?: boolean;
};

export type ClarificationQuestion = {
  id: string;
  question: string;
  context?: string;
  options?: readonly ClarificationOption[];
};

export type ClarificationAnsweredInformation = {
  key: string;
  value: string;
};

export type ClarificationResult = {
  status: ClarificationStatus;
  readyToProceed: boolean;
  questions: readonly ClarificationQuestion[];
  missingInformation: readonly string[];
  answeredInformation: readonly ClarificationAnsweredInformation[];
  reasoningSummary: string;
  roundCount: number;
  maxRounds: number;
  /**
   * Optional. When present, the clarification phase was short-circuited without
   * running the clarifier subagent. See {@link ClarificationSkipReason}.
   */
  skipReason?: ClarificationSkipReason;
};

export type ClarificationState = {
  originalRequest: string;
  missingInformation: readonly string[];
  answeredInformation: readonly ClarificationAnsweredInformation[];
  openQuestions: readonly ClarificationQuestion[];
  status: ClarificationStatus;
  readyToProceed: boolean;
  roundCount: number;
  maxRounds: number;
  questionsPerRound: ClarificationQuestionsPerRound;
};

export type ArchivedClarificationState = ClarificationState & {
  archived: true;
};

export type ClarificationConfig = {
  enabled: boolean;
  maxRounds: number;
  questionsPerRound: ClarificationQuestionsPerRound;
  mode: ClarificationMode;
  /**
   * Pre-clarifier triage gate. When enabled (default), a cheap classifier
   * inspects each new request and decides whether the full clarifier round is
   * needed. Self-contained or continuation prompts (`continue`, `yes`, trivial
   * questions) skip the clarifier and transition straight to execution.
   *
   * The classifier instance is constructed by the scaffold and passed into the
   * workflow controller; this config only controls enable/disable and any
   * explicit classifier/model override.
   */
  triage?: ClarificationTriageConfig;
};

/**
 * Configuration for the pre-clarifier triage gate.
 *
 * - `enabled`: defaults to `true`. Set to `false` to restore the legacy
 *   always-clarify behavior.
 * - `classifier` / `model`: explicit override for the classifier. The
 *   scaffold falls back to `modelRuntime.getModelForRole("triage")` when
 *   neither is provided.
 */
export type ClarificationTriageConfig = {
  enabled?: boolean;
};

export const clarificationStatusSchema = z.enum([
  "needs_clarification",
  "ready_to_proceed",
  "blocked",
]);

export const clarificationSkipReasonSchema = z.enum([
  "triage_classifier",
  "user_command",
  "config_disabled",
]);

export const clarificationOptionSchema = z.object({
  label: z.string().trim().min(1),
  description: z.string().trim().min(1),
  recommended: z.boolean().optional(),
});

export const clarificationQuestionSchema = z.object({
  id: z.string(),
  question: z.string(),
  context: z.string().optional(),
  options: z
    .array(clarificationOptionSchema)
    .min(2)
    .max(4)
    .superRefine((options, ctx) => {
      if (options.filter((option) => option.recommended).length > 1) {
        ctx.addIssue({
          code: "custom",
          message: "Clarification questions can recommend at most one option.",
        });
      }
    })
    .optional(),
});

export const clarificationAnsweredInformationSchema = z.object({
  key: z.string(),
  value: z.string(),
});

export const clarificationResultSchema = z.object({
  status: clarificationStatusSchema,
  readyToProceed: z.boolean(),
  questions: z.array(clarificationQuestionSchema),
  missingInformation: z.array(z.string()),
  answeredInformation: z.array(clarificationAnsweredInformationSchema),
  reasoningSummary: z.string(),
  roundCount: z.number().int(),
  maxRounds: z.number().int(),
  skipReason: clarificationSkipReasonSchema.optional(),
});
