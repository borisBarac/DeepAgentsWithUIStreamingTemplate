import { describe, expect, it } from "bun:test";

import { createReviewConfig, getDefaultReviewConfig } from "./config.ts";
import { DEFAULT_REVIEW_MAX_REVISIONS } from "./defaults.ts";
import { createReviewReport, parseReviewReport } from "./report.ts";
import {
  createReviewState,
  isReviewApproved,
  lifecycleStatusForReport,
  markReviewCaveated,
  recordReviewReport,
  summarizeReviewForTrace,
} from "./state.ts";
import { type ReviewReport, reviewReportSchema } from "./types.ts";

const approvedReport: ReviewReport = {
  status: "approved",
  score: 92,
  criticalIssues: [],
  majorIssues: [],
  minorIssues: [{ issue: "typo", impact: "cosmetic", evidence: "header" }],
  requiredChanges: [],
  finalRecommendation: "ready to deliver",
};

const changesReport: ReviewReport = {
  status: "changes_required",
  score: 60,
  criticalIssues: [{ issue: "no tests", impact: "correctness", evidence: "none present" }],
  majorIssues: [],
  minorIssues: [],
  requiredChanges: ["add tests for the consumer"],
  finalRecommendation: "fix required changes before delivery",
};

describe("createReviewConfig", () => {
  it("defaults maxRevisions to 2", () => {
    expect(createReviewConfig().maxRevisions).toBe(DEFAULT_REVIEW_MAX_REVISIONS);
    expect(getDefaultReviewConfig().maxRevisions).toBe(2);
  });

  it("honours explicit maxRevisions overrides", () => {
    expect(createReviewConfig({ maxRevisions: 4 }).maxRevisions).toBe(4);
  });

  it("rejects non-positive maxRevisions", () => {
    expect(() => createReviewConfig({ maxRevisions: 0 })).toThrow();
    expect(() => createReviewConfig({ maxRevisions: -1 })).toThrow();
    expect(() => createReviewConfig({ maxRevisions: 1.5 })).toThrow();
  });
});

describe("reviewReportSchema", () => {
  it("validates a well-formed report with all structured fields", () => {
    const parsed = reviewReportSchema.parse(changesReport);
    expect(parsed.status).toBe("changes_required");
    expect(parsed.criticalIssues[0]?.issue).toBe("no tests");
    expect(parsed.requiredChanges).toEqual(["add tests for the consumer"]);
  });
});

describe("parseReviewReport", () => {
  it("parses raw JSON content into a structured report", () => {
    const content = JSON.stringify({
      status: "approved",
      score: 90,
      criticalIssues: [],
      majorIssues: [],
      minorIssues: [],
      requiredChanges: [],
      finalRecommendation: "ship it",
    });

    const report = parseReviewReport(content);
    expect(report.status).toBe("approved");
    expect(report.score).toBe(90);
    expect(report.finalRecommendation).toBe("ship it");
  });

  it("accepts snake_case keys from the review prompt contract", () => {
    const content = JSON.stringify({
      status: "changes_required",
      score: 55,
      critical_issues: [{ issue: "x", impact: "y", evidence: "z" }],
      major_issues: [],
      minor_issues: [],
      required_changes: ["fix x"],
      final_recommendation: "needs work",
    });

    const report = parseReviewReport(content);
    expect(report.status).toBe("changes_required");
    expect(report.criticalIssues[0]?.issue).toBe("x");
    expect(report.requiredChanges).toEqual(["fix x"]);
  });

  it("extracts JSON from fenced code blocks", () => {
    const content = `Here is my review:\n\`\`\`json\n${JSON.stringify({
      status: "approved",
      score: 88,
      criticalIssues: [],
      majorIssues: [],
      minorIssues: [],
      requiredChanges: [],
      finalRecommendation: "ok",
    })}\n\`\`\``;

    expect(parseReviewReport(content).status).toBe("approved");
  });

  it("returns a blocked report when content is unparseable", () => {
    const report = parseReviewReport("I cannot review this cleanly");
    expect(report.status).toBe("blocked");
    expect(report.score).toBe(0);
  });
});

describe("review lifecycle state", () => {
  it("starts in review_required with the configured loop limit", () => {
    const state = createReviewState({ maxRevisions: 3 });
    expect(state.status).toBe("review_required");
    expect(state.maxRevisions).toBe(3);
    expect(state.reviewCount).toBe(0);
    expect(state.caveated).toBe(false);
    expect(state.required).toBe(true);
  });

  it("maps report statuses to lifecycle statuses", () => {
    expect(lifecycleStatusForReport("approved")).toBe("approved");
    expect(lifecycleStatusForReport("changes_required")).toBe("changes_required");
    expect(lifecycleStatusForReport("blocked")).toBe("blocked");
  });

  it("records reports and increments the review count", () => {
    const state = createReviewState();
    const next = recordReviewReport(state, changesReport, 1);
    expect(next.status).toBe("changes_required");
    expect(next.reviewCount).toBe(1);
    expect(next.reports).toHaveLength(1);
    expect(next.report?.status).toBe("changes_required");
  });

  it("marks the state caveated for delivery without approval", () => {
    const caveated = markReviewCaveated(recordReviewReport(createReviewState(), changesReport, 1));
    expect(caveated.caveated).toBe(true);
    expect(isReviewApproved(caveated)).toBe(false);
  });

  it("treats an approved, non-caveated state as approved", () => {
    const approved = recordReviewReport(createReviewState(), approvedReport, 1);
    expect(isReviewApproved(approved)).toBe(true);
  });
});

describe("createReviewReport", () => {
  it("defaults to a blocked report when no overrides are given", () => {
    const report = createReviewReport();
    expect(report.status).toBe("blocked");
    expect(report.criticalIssues).toEqual([]);
  });
});

describe("summarizeReviewForTrace", () => {
  it("reports a pending summary when no review state exists", () => {
    expect(summarizeReviewForTrace(undefined).delivery).toBe("pending");
    expect(summarizeReviewForTrace(undefined).requested).toBe(false);
  });

  it("surfaces review requested, status, score, required changes, and delivery for traces", () => {
    const approved = recordReviewReport(createReviewState(), approvedReport, 1);
    const summary = summarizeReviewForTrace(approved);
    expect(summary.requested).toBe(true);
    expect(summary.status).toBe("approved");
    expect(summary.score).toBe(92);
    expect(summary.requiredChanges).toEqual([]);
    expect(summary.followUp).toBe(false);
    expect(summary.delivery).toBe("approved");
  });

  it("marks follow-up and caveated delivery after a revision loop", () => {
    let state = recordReviewReviewOnce(createReviewState(), changesReport);
    state = markReviewCaveated(recordReviewReport(state, changesReport, 2));
    const summary = summarizeReviewForTrace(state);
    expect(summary.followUp).toBe(true);
    expect(summary.reviewCount).toBe(2);
    expect(summary.delivery).toBe("caveated");
    expect(summary.requiredChanges).toEqual(["add tests for the consumer"]);
  });
});

function recordReviewReviewOnce(state: ReturnType<typeof createReviewState>, report: ReviewReport) {
  return recordReviewReport(state, report, 1);
}
