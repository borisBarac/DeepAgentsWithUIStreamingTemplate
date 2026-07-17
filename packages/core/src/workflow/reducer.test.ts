import { describe, expect, it } from "bun:test";

import { createWorkflowState, reduceWorkflowState } from "./reducer.ts";

describe("reduceWorkflowState", () => {
  it("continues one-round clarification readiness into execution", () => {
    const initial = createWorkflowState("Create a physical kanban board");
    const clarification = {
      originalRequest: initial.originalRequest,
      missingInformation: [],
      answeredInformation: [],
      openQuestions: [],
      status: "ready_to_proceed" as const,
      readyToProceed: true,
      roundCount: 1,
      maxRounds: 1,
      questionsPerRound: 3 as const,
    };

    const next = reduceWorkflowState(initial, {
      type: "clarification_completed",
      state: clarification,
      result: {
        status: "ready_to_proceed",
        readyToProceed: true,
        questions: [],
        missingInformation: [],
        answeredInformation: [],
        reasoningSummary: "Proceed with assumptions.",
        roundCount: 1,
        maxRounds: 1,
      },
    });

    expect(next.phase).toBe("execution");
  });

  it("requires regeneration and re-review after requested changes", () => {
    const initial = {
      ...createWorkflowState("Build it"),
      phase: "review" as const,
      outcome: {
        candidateFinalResponse: "v1",
        deliverables: [],
        validationEvidence: [],
        assumptions: [],
      },
      productBatch: { products: [{ id: "p", title: "P", description: "D" }] },
    };
    const report = {
      status: "changes_required" as const,
      score: 60,
      criticalIssues: [],
      majorIssues: [],
      minorIssues: [],
      requiredChanges: ["Add validation"],
      finalRecommendation: "Revise",
    };
    const revision = reduceWorkflowState(initial, {
      type: "review_completed",
      report,
      maxRevisions: 2,
    });
    expect(revision).toMatchObject({
      phase: "revision",
      revisionCount: 1,
      productBatch: undefined,
    });
    const executed = reduceWorkflowState(revision, {
      type: "execution_completed",
      generativeUiEnabled: true,
      outcome: {
        candidateFinalResponse: "v2",
        deliverables: [],
        validationEvidence: ["checked"],
        assumptions: [],
      },
    });
    expect(executed.phase).toBe("product_generation");
  });

  it("delivers with caveats when the review budget is exhausted", () => {
    const state = { ...createWorkflowState("Build it"), phase: "review" as const };
    const report = {
      status: "blocked" as const,
      score: 40,
      criticalIssues: [],
      majorIssues: [],
      minorIssues: [],
      requiredChanges: ["Unresolved"],
      finalRecommendation: "Blocked",
    };
    expect(
      reduceWorkflowState(state, { type: "review_completed", report, maxRevisions: 1 }),
    ).toMatchObject({
      phase: "delivery_ready",
      caveated: true,
    });
  });
});
