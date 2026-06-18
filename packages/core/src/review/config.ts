import { DEFAULT_REVIEW_MAX_REVISIONS } from "./defaults.ts";
import type { ReviewConfig } from "./types.ts";

const DEFAULT_REVIEW_CONFIG_VALUE: ReviewConfig = Object.freeze({
  maxRevisions: DEFAULT_REVIEW_MAX_REVISIONS,
});

function assertMaxRevisions(value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error("Review maxRevisions must be a positive integer.");
  }
}

export function getDefaultReviewConfig(): ReviewConfig {
  return DEFAULT_REVIEW_CONFIG_VALUE;
}

export function createReviewConfig(overrides: Partial<ReviewConfig> = {}): ReviewConfig {
  const maxRevisions = overrides.maxRevisions ?? DEFAULT_REVIEW_CONFIG_VALUE.maxRevisions;
  assertMaxRevisions(maxRevisions);
  return { maxRevisions };
}
