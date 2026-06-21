import { createClarificationConfig } from "./config.ts";
import type {
  ArchivedClarificationState,
  ClarificationAnsweredInformation,
  ClarificationConfig,
  ClarificationQuestion,
  ClarificationResult,
  ClarificationState,
} from "./types.ts";

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
  const answeredByKey = new Map(state.answeredInformation.map((item) => [item.key, item]));

  for (const item of answeredInformation) {
    answeredByKey.set(item.key, item);
  }

  return {
    ...state,
    answeredInformation: [...answeredByKey.values()],
    missingInformation: state.missingInformation.filter((item) => !answeredKeys.has(item)),
    openQuestions: state.openQuestions.filter((question) => !answeredKeys.has(question.id)),
  };
}

export function selectUserFacingQuestions(
  result: ClarificationResult,
): readonly ClarificationQuestion[] {
  return result.status === "needs_clarification" ? [...result.questions] : [];
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
