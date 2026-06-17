import { createReviewConfig } from "./config.ts";
import { DEFAULT_REVIEW_MAX_REVISIONS } from "./defaults.ts";
import type {
  ReviewConfig,
  ReviewLifecycleStatus,
  ReviewReport,
  ReviewReportStatus,
  ReviewState,
} from "./types.ts";

export function createReviewState(
  config: Partial<ReviewConfig> = {},
  overrides: Partial<ReviewState> = {},
): ReviewState {
  const resolved = createReviewConfig(config);
  return {
    status: "review_required",
    reports: [],
    reviewCount: 0,
    maxRevisions: resolved.maxRevisions,
    caveated: false,
    required: true,
    ...overrides,
  };
}

export function lifecycleStatusForReport(reportStatus: ReviewReportStatus): ReviewLifecycleStatus {
  if (reportStatus === "approved") return "approved";
  if (reportStatus === "blocked") return "blocked";
  return "changes_required";
}

export function recordReviewReport(
  state: ReviewState,
  report: ReviewReport,
  reviewCount: number,
): ReviewState {
  return {
    ...state,
    status: lifecycleStatusForReport(report.status),
    report,
    reports: [...state.reports, report],
    reviewCount,
  };
}

export function markReviewCaveated(state: ReviewState): ReviewState {
  return { ...state, caveated: true };
}

export function isReviewApproved(state: ReviewState | undefined): boolean {
  return state?.status === "approved" && !state.caveated;
}

export function defaultMaxRevisions(): number {
  return DEFAULT_REVIEW_MAX_REVISIONS;
}

export type ReviewTraceSummary = {
  requested: boolean;
  status: ReviewLifecycleStatus;
  score: number | undefined;
  requiredChanges: string[];
  followUp: boolean;
  reviewCount: number;
  delivery: "approved" | "caveated" | "pending";
};

function deliveryStatusForReview(state: ReviewState): ReviewTraceSummary["delivery"] {
  if (state.caveated) {
    return "caveated";
  }
  if (state.status === "approved") {
    return "approved";
  }
  return "pending";
}

export function summarizeReviewForTrace(state: ReviewState | undefined): ReviewTraceSummary {
  if (!state) {
    return {
      requested: false,
      status: "review_required",
      score: undefined,
      requiredChanges: [],
      followUp: false,
      reviewCount: 0,
      delivery: "pending",
    };
  }

  return {
    requested: state.reviewCount > 0,
    status: state.status,
    score: state.report?.score,
    requiredChanges: state.report?.requiredChanges ?? [],
    followUp: state.reviewCount > 1,
    reviewCount: state.reviewCount,
    delivery: deliveryStatusForReview(state),
  };
}
