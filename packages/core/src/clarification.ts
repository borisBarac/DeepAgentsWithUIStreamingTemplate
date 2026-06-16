import { z } from "zod";

export const DEFAULT_CLARIFICATION_MAX_ROUNDS = 10 as const;
export const DEFAULT_CLARIFICATION_QUESTIONS_PER_ROUND = 3 as const;
export const DEFAULT_CLARIFICATION_MODE = "mandatory-preflight" as const;

export type ClarificationMode = typeof DEFAULT_CLARIFICATION_MODE;
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

const DEFAULT_CLARIFICATION_CONFIG_VALUE: ClarificationConfig = Object.freeze({
  enabled: true,
  maxRounds: DEFAULT_CLARIFICATION_MAX_ROUNDS,
  questionsPerRound: DEFAULT_CLARIFICATION_QUESTIONS_PER_ROUND,
  mode: DEFAULT_CLARIFICATION_MODE,
});

function assertPositiveInteger(value: number, fieldName: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Clarification ${fieldName} must be a positive integer.`);
  }
}

function assertQuestionsPerRound(value: number): asserts value is ClarificationQuestionsPerRound {
  if (value < 1 || value > 3 || !Number.isInteger(value)) {
    throw new Error("Clarification questionsPerRound must be an integer between 1 and 3.");
  }
}

function dedupeMissingInformation(items: readonly string[]): string[] {
  return [...new Set(items)];
}

function mergeAnsweredInformation(
  existing: readonly ClarificationAnsweredInformation[],
  next: readonly ClarificationAnsweredInformation[],
): ClarificationAnsweredInformation[] {
  const answeredByKey = new Map(existing.map((item) => [item.key, item]));

  for (const item of next) {
    answeredByKey.set(item.key, item);
  }

  return [...answeredByKey.values()];
}

function validateClarificationResultConsistency(result: ClarificationResult): void {
  if (result.status === "ready_to_proceed" && !result.readyToProceed) {
    throw new Error(
      'Clarification results with status "ready_to_proceed" must set readyToProceed to true.',
    );
  }

  if (result.status !== "ready_to_proceed" && result.readyToProceed) {
    throw new Error(
      "Clarification results that are not ready_to_proceed cannot set readyToProceed to true.",
    );
  }
}

function validateClarificationResultRound(
  state: ClarificationState,
  result: ClarificationResult,
): void {
  assertPositiveInteger(result.roundCount, "roundCount");
  assertPositiveInteger(result.maxRounds, "maxRounds");

  if (result.roundCount !== state.roundCount + 1) {
    throw new Error(
      `Clarification roundCount must increment sequentially. Expected ${state.roundCount + 1}, received ${result.roundCount}.`,
    );
  }

  if (result.maxRounds !== state.maxRounds) {
    throw new Error(
      `Clarification result maxRounds must match the active state. Expected ${state.maxRounds}, received ${result.maxRounds}.`,
    );
  }

  if (result.roundCount > result.maxRounds) {
    throw new Error("Clarification roundCount cannot exceed maxRounds.");
  }
}

function validateClarificationQuestionBatch(
  state: ClarificationState,
  result: ClarificationResult,
): void {
  if (result.questions.length > state.questionsPerRound) {
    throw new Error(
      `Clarification question batches cannot exceed ${state.questionsPerRound} questions per round.`,
    );
  }
}

function deriveResultStatus(result: ClarificationResult): ClarificationStatus {
  if (result.status === "ready_to_proceed") {
    return "ready_to_proceed";
  }

  if (result.status === "blocked" || result.roundCount >= result.maxRounds) {
    return "blocked";
  }

  return "needs_clarification";
}

export function getDefaultClarificationConfig(): ClarificationConfig {
  return DEFAULT_CLARIFICATION_CONFIG_VALUE;
}

export function createClarificationConfig(
  overrides: Partial<ClarificationConfig> = {},
): ClarificationConfig {
  const maxRounds = overrides.maxRounds ?? DEFAULT_CLARIFICATION_CONFIG_VALUE.maxRounds;
  const questionsPerRound =
    overrides.questionsPerRound ?? DEFAULT_CLARIFICATION_CONFIG_VALUE.questionsPerRound;

  assertPositiveInteger(maxRounds, "maxRounds");
  assertQuestionsPerRound(questionsPerRound);

  return {
    enabled: overrides.enabled ?? DEFAULT_CLARIFICATION_CONFIG_VALUE.enabled,
    maxRounds,
    questionsPerRound,
    mode: overrides.mode ?? DEFAULT_CLARIFICATION_CONFIG_VALUE.mode,
  };
}

export function createClarificationState(
  originalRequest: string,
  configOverrides: Partial<ClarificationConfig> = {},
): ClarificationState {
  const config = createClarificationConfig(configOverrides);

  return {
    originalRequest,
    missingInformation: [],
    answeredInformation: [],
    openQuestions: [],
    status: "needs_clarification",
    readyToProceed: false,
    roundCount: 0,
    maxRounds: config.maxRounds,
    questionsPerRound: config.questionsPerRound,
  };
}

export function recordClarificationAnswers(
  state: ClarificationState,
  answeredInformation: readonly ClarificationAnsweredInformation[],
): ClarificationState {
  const answeredKeys = new Set(answeredInformation.map((item) => item.key));

  return {
    ...state,
    answeredInformation: mergeAnsweredInformation(state.answeredInformation, answeredInformation),
    missingInformation: state.missingInformation.filter((item) => !answeredKeys.has(item)),
    openQuestions: state.openQuestions.filter((question) => !answeredKeys.has(question.id)),
  };
}

export function applyClarificationResult(
  state: ClarificationState,
  result: ClarificationResult,
): ClarificationState {
  validateClarificationResultConsistency(result);
  validateClarificationResultRound(state, result);
  validateClarificationQuestionBatch(state, result);

  const status = deriveResultStatus(result);
  const answeredInformation = mergeAnsweredInformation(
    state.answeredInformation,
    result.answeredInformation,
  );
  const missingInformation =
    status === "ready_to_proceed" ? [] : dedupeMissingInformation(result.missingInformation);

  return {
    ...state,
    missingInformation,
    answeredInformation,
    openQuestions: status === "needs_clarification" ? [...result.questions] : [],
    status,
    readyToProceed: status === "ready_to_proceed",
    roundCount: result.roundCount,
    maxRounds: result.maxRounds,
  };
}

export function selectUserFacingQuestions(result: ClarificationResult): readonly string[] {
  return result.status === "needs_clarification"
    ? result.questions.map((question) => question.question)
    : [];
}

export function resolveClarificationGate(
  options: ResolveClarificationGateOptions,
): ClarificationGateDecision {
  const config = createClarificationConfig(options.config);

  if (!config.enabled || config.mode !== "mandatory-preflight") {
    return {
      phase: "execution",
      shouldDelegateToClarifier: false,
      canPlan: true,
      canDelegate: true,
      state: options.state ?? null,
      config,
    };
  }

  const state =
    options.state ??
    (options.isNewRequest ? createClarificationState(options.request, config) : null);

  if (!state) {
    return {
      phase: "clarification",
      shouldDelegateToClarifier: true,
      canPlan: false,
      canDelegate: false,
      state: createClarificationState(options.request, config),
      config,
    };
  }

  if (state.status === "ready_to_proceed") {
    return {
      phase: "execution",
      shouldDelegateToClarifier: false,
      canPlan: true,
      canDelegate: true,
      state,
      config,
    };
  }

  if (state.status === "blocked") {
    return {
      phase: "blocked",
      shouldDelegateToClarifier: false,
      canPlan: false,
      canDelegate: false,
      state,
      config,
    };
  }

  return {
    phase: "clarification",
    shouldDelegateToClarifier: true,
    canPlan: false,
    canDelegate: false,
    state,
    config,
  };
}

export function clearClarificationState(state: ClarificationState): ClarificationState | null {
  return state.status === "ready_to_proceed" ? null : state;
}

export function archiveClarificationState(state: ClarificationState): ArchivedClarificationState {
  if (state.status === "needs_clarification") {
    throw new Error("Cannot archive clarification state before the intake is resolved.");
  }

  return {
    ...state,
    openQuestions: [],
    archived: true,
  };
}
