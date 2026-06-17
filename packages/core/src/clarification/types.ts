import { z } from "zod";

export type ClarificationMode = "mandatory-preflight";
export type ClarificationQuestionsPerRound = 1 | 2 | 3;
export type ClarificationStatus = "needs_clarification" | "ready_to_proceed" | "blocked";
export type ClarificationGatePhase = "clarification" | "execution" | "blocked";

export type ClarificationQuestion = {
  id: string;
  question: string;
  context?: string;
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
};

export type ClarificationGateDecision = {
  phase: ClarificationGatePhase;
  shouldDelegateToClarifier: boolean;
  canPlan: boolean;
  canDelegate: boolean;
  state: ClarificationState | null;
  config: ClarificationConfig;
};

export const clarificationStatusSchema = z.enum([
  "needs_clarification",
  "ready_to_proceed",
  "blocked",
]);

export const clarificationQuestionSchema = z.object({
  id: z.string(),
  question: z.string(),
  context: z.string().optional(),
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
