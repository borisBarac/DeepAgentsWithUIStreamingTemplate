import {
  DEFAULT_CLARIFICATION_MAX_ROUNDS,
  DEFAULT_CLARIFICATION_MODE,
  DEFAULT_CLARIFICATION_QUESTIONS_PER_ROUND,
} from "./defaults.ts";
import type { ClarificationConfig, ClarificationQuestionsPerRound } from "./types.ts";

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
