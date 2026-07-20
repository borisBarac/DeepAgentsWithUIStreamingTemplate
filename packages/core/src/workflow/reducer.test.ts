import { describe, expect, it } from "bun:test";

import { createWorkflowState, reduceWorkflowState } from "./reducer.ts";

describe("reduceWorkflowState", () => {
  it("routes product requests through product generation when enabled, review otherwise", () => {
    const outcome = {
      candidateFinalResponse: "done",
      deliverables: [],
      validationEvidence: [],
      assumptions: [],
    };
    const productState = {
      ...createWorkflowState("Create products", {
        existingProducts: null,
        productMode: "create" as const,
        targetProductCount: 3,
        productGenerationEnabled: true,
      }),
      phase: "execution" as const,
      clarificationResult: {
        requestKind: "products" as const,
        status: "ready_to_proceed" as const,
        readyToProceed: true,
        questions: [],
        missingInformation: [],
        answeredInformation: [],
        reasoningSummary: "Ready",
        roundCount: 0,
        maxRounds: 1,
      },
    };
    expect(reduceWorkflowState(productState, { type: "execution_completed", outcome }).phase).toBe(
      "product_generation",
    );
    expect(
      reduceWorkflowState(
        {
          ...productState,
          productGenerationEnabled: false,
        },
        { type: "execution_completed", outcome },
      ).phase,
    ).toBe("review");
  });

  it("continues one-round clarification readiness into execution", () => {
    const initial = createWorkflowState("Create a physical kanban board");
    const clarification = {
      originalRequest: initial.originalRequest,
      missingInformation: [],
      answeredInformation: [],
      openQuestions: [],
      requestKind: "products" as const,
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
        requestKind: "products",
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

  it("requires revision and re-review after requested changes", () => {
    const initial = {
      ...createWorkflowState("Build it"),
      phase: "review" as const,
      outcome: {
        candidateFinalResponse: "v1",
        deliverables: [],
        validationEvidence: [],
        assumptions: [],
      },
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
      maxReviewCycles: 2,
    });
    expect(revision).toMatchObject({
      phase: "revision",
      revisionCount: 1,
    });
    const executed = reduceWorkflowState(revision, {
      type: "execution_completed",
      outcome: {
        candidateFinalResponse: "v2",
        deliverables: [],
        validationEvidence: ["checked"],
        assumptions: [],
      },
    });
    expect(executed.phase).toBe("review");
  });

  it("routes product revisions through execution and product generation again", () => {
    const batch = {
      mode: "create" as const,
      gridRoot: "products",
      products: [{ id: "p1", title: "One", description: "First" }],
    };
    const state = {
      ...createWorkflowState("Create one product", {
        existingProducts: null,
        productMode: "create" as const,
        targetProductCount: 1,
        productGenerationEnabled: true,
      }),
      phase: "review" as const,
      clarificationResult: {
        requestKind: "products" as const,
        status: "ready_to_proceed" as const,
        readyToProceed: true,
        questions: [],
        missingInformation: [],
        answeredInformation: [],
        reasoningSummary: "Ready",
        roundCount: 0,
        maxRounds: 1,
      },
      generatedProducts: batch,
    };
    const revision = reduceWorkflowState(state, {
      type: "review_completed",
      maxReviewCycles: 2,
      report: {
        status: "changes_required",
        score: 60,
        criticalIssues: [],
        majorIssues: [],
        minorIssues: [],
        requiredChanges: ["Change title"],
        finalRecommendation: "Revise",
      },
    });
    expect(revision.phase).toBe("revision");
    expect(
      reduceWorkflowState(revision, {
        type: "execution_completed",
        outcome: {
          candidateFinalResponse: "v2",
          deliverables: [],
          validationEvidence: [],
          assumptions: [],
        },
      }).phase,
    ).toBe("product_generation");
  });

  it("delivers with caveats when the review budget is exhausted", () => {
    const state = { ...createWorkflowState("Build it"), phase: "review" as const };
    const report = {
      requestKind: "products",
      status: "blocked" as const,
      score: 40,
      criticalIssues: [],
      majorIssues: [],
      minorIssues: [],
      requiredChanges: ["Unresolved"],
      finalRecommendation: "Blocked",
    };
    expect(
      reduceWorkflowState(state, { type: "review_completed", report, maxReviewCycles: 1 }),
    ).toMatchObject({
      phase: "delivery_ready",
      caveated: true,
    });
  });

  it("does not emit product UI before review approval", () => {
    const batch = {
      mode: "create" as const,
      gridRoot: "products",
      products: [{ id: "p1", title: "One", description: "First" }],
    };
    const baseState = {
      ...createWorkflowState("Create one product", {
        existingProducts: null,
        productMode: "create" as const,
        targetProductCount: 1,
        productGenerationEnabled: true,
      }),
      phase: "product_generation" as const,
      clarificationResult: {
        requestKind: "products" as const,
        status: "ready_to_proceed" as const,
        readyToProceed: true,
        questions: [],
        missingInformation: [],
        answeredInformation: [],
        reasoningSummary: "Ready",
        roundCount: 0,
        maxRounds: 1,
      },
    };
    const submitted = reduceWorkflowState(baseState, {
      type: "products_submitted",
      batch,
    });
    expect(submitted.phase).toBe("review");
    expect(submitted.pendingProductUi).toBeUndefined();
    const revision = reduceWorkflowState(submitted, {
      type: "review_completed",
      maxReviewCycles: 2,
      report: {
        status: "changes_required",
        score: 60,
        criticalIssues: [],
        majorIssues: [],
        minorIssues: [],
        requiredChanges: ["Change title"],
        finalRecommendation: "Revise",
      },
    });
    expect(revision.phase).toBe("revision");
    expect(revision.pendingProductUi).toBeUndefined();
    const approved = reduceWorkflowState(
      { ...revision, phase: "review", generatedProducts: batch },
      {
        type: "review_completed",
        maxReviewCycles: 2,
        report: {
          status: "approved",
          score: 95,
          criticalIssues: [],
          majorIssues: [],
          minorIssues: [],
          requiredChanges: [],
          finalRecommendation: "Ship.",
        },
      },
    );
    expect(approved.phase).toBe("delivery_ready");
    expect(approved.pendingProductUi).toBeDefined();
  });
});
