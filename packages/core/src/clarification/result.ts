import type {
  ClarificationAnsweredInformation,
  ClarificationResult,
  ClarificationState,
  ClarificationStatus,
} from "./types.ts";

function dedupeMissingInformation(items: readonly string[]): string[] {
  return [...new Set(items)];
}

function mergeAnsweredInformation(
  existing: readonly ClarificationAnsweredInformation[],
  next: readonly ClarificationAnsweredInformation[],
): readonly ClarificationAnsweredInformation[] {
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
  if (!Number.isInteger(result.roundCount) || result.roundCount < 0) {
    throw new Error("Clarification roundCount must be a non-negative integer.");
  }

  if (!Number.isInteger(result.maxRounds) || result.maxRounds < 1) {
    throw new Error("Clarification maxRounds must be a positive integer.");
  }

  const expectedRoundCount =
    result.status === "ready_to_proceed" ? state.roundCount : state.roundCount + 1;
  if (result.roundCount !== expectedRoundCount) {
    throw new Error(
      `Clarification roundCount must increment for unresolved results and remain unchanged for ready results. Expected ${expectedRoundCount}, received ${result.roundCount}.`,
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
  const hasReachedRoundCap = result.roundCount === result.maxRounds;

  // The cap is terminal: it overrides an unresolved or blocked model result.
  if (result.status === "ready_to_proceed" || hasReachedRoundCap) {
    return "ready_to_proceed";
  }

  if (result.status === "blocked") {
    return "blocked";
  }

  return "needs_clarification";
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
