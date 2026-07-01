import { z } from "zod";

export type ClarificationMode = "mandatory-preflight";
export type ClarificationQuestionsPerRound = 1 | 2 | 3;
export type ClarificationStatus = "needs_clarification" | "ready_to_proceed" | "blocked";
export type ClarificationGatePhase =
  | "clarification"
  | "product_generation"
  | "review"
  | "execution"
  | "blocked";
export type ClarificationFlowRequiredSubagent = "clarifier" | "product-generator" | "review-agent";
export type ProductFlowReviewStatus = "approved" | "changes_required" | "blocked";

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
};

export type ResolveClarificationGateOptions = {
  isNewRequest: boolean;
  request: string;
  state?: ClarificationState | null;
  config?: Partial<ClarificationConfig>;
  generativeUiEnabled?: boolean;
  productBatchGenerated?: boolean;
  reviewStatus?: ProductFlowReviewStatus | null;
  reviewFeedback?: string;
};

export type ClarificationGateDecision = {
  phase: ClarificationGatePhase;
  shouldDelegateToClarifier: boolean;
  requiredSubagent?: ClarificationFlowRequiredSubagent;
  canPlan: boolean;
  canDelegate: boolean;
  canFinalize: boolean;
  reviewFeedback?: string;
  state: ClarificationState | null;
  config: ClarificationConfig;
};

export const clarificationStatusSchema = z.enum([
  "needs_clarification",
  "ready_to_proceed",
  "blocked",
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
});
