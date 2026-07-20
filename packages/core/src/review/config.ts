import { DEFAULT_REVIEW_MAX_REVISIONS } from "./defaults.ts";
import type { ReviewConfig } from "./types.ts";

const DEFAULT_REVIEW_CONFIG_VALUE: ReviewConfig = Object.freeze({
  maxReviewCycles: DEFAULT_REVIEW_MAX_REVISIONS,
});

function assertMaxRevisions(value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error("Review maxReviewCycles must be a positive integer.");
  }
}

export function createReviewConfig(overrides: Partial<ReviewConfig> = {}): ReviewConfig {
  const maxReviewCycles = overrides.maxReviewCycles ?? DEFAULT_REVIEW_CONFIG_VALUE.maxReviewCycles;
  assertMaxRevisions(maxReviewCycles);
  return { maxReviewCycles };
}
