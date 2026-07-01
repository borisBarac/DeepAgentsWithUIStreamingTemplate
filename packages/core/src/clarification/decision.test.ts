import { describe, expect, it } from "bun:test";
import { resolveClarificationGate } from "./decision.ts";
import { applyClarificationResult } from "./result.ts";
import { createClarificationState } from "./state.ts";

describe("clarification orchestration", () => {
  it("sends every new user request into clarification first", () => {
    const decision = resolveClarificationGate({
      isNewRequest: true,
      request: "Build a dashboard for the Q2 launch.",
    });

    expect(decision.phase).toBe("clarification");
    expect(decision.shouldDelegateToClarifier).toBeTrue();
    expect(decision.requiredSubagent).toBe("clarifier");
    expect(decision.canPlan).toBeFalse();
    expect(decision.canDelegate).toBeFalse();
    expect(decision.canFinalize).toBeFalse();
    expect(decision.state?.originalRequest).toBe("Build a dashboard for the Q2 launch.");
  });

  it("keeps planning and delegation blocked while clarification is unresolved", () => {
    const state = applyClarificationResult(
      createClarificationState("Ship the feature.", { maxRounds: 10 }),
      {
        status: "needs_clarification",
        readyToProceed: false,
        questions: [
          { id: "platform", question: "Which platform should this ship on first?" },
          { id: "deadline", question: "What deadline should the plan optimize for?" },
        ],
        missingInformation: ["platform", "deadline"],
        answeredInformation: [],
        reasoningSummary: "Execution choices change with platform and deadline.",
        roundCount: 1,
        maxRounds: 10,
      },
    );

    const decision = resolveClarificationGate({
      isNewRequest: false,
      request: "Ship the feature.",
      state,
    });

    expect(decision.phase).toBe("clarification");
    expect(decision.shouldDelegateToClarifier).toBeTrue();
    expect(decision.requiredSubagent).toBe("clarifier");
    expect(decision.canPlan).toBeFalse();
    expect(decision.canDelegate).toBeFalse();
    expect(decision.canFinalize).toBeFalse();
  });

  it("unlocks normal execution once clarification is ready", () => {
    const state = applyClarificationResult(
      createClarificationState("Ship the feature.", { maxRounds: 10 }),
      {
        status: "ready_to_proceed",
        readyToProceed: true,
        questions: [],
        missingInformation: [],
        answeredInformation: [
          { key: "platform", value: "web" },
          { key: "deadline", value: "end of month" },
        ],
        reasoningSummary: "The request now has enough scope and timing detail.",
        roundCount: 1,
        maxRounds: 10,
      },
    );

    const decision = resolveClarificationGate({
      isNewRequest: false,
      request: "Ship the feature.",
      state,
    });

    expect(decision.phase).toBe("execution");
    expect(decision.shouldDelegateToClarifier).toBeFalse();
    expect(decision.canPlan).toBeTrue();
    expect(decision.canDelegate).toBeTrue();
    expect(decision.canFinalize).toBeTrue();
  });

  it("returns blocked when the clarification state is blocked", () => {
    const state = applyClarificationResult(
      createClarificationState("Launch the product.", { maxRounds: 2 }),
      {
        status: "needs_clarification",
        readyToProceed: false,
        questions: [{ id: "market", question: "Which market launches first?" }],
        missingInformation: ["market"],
        answeredInformation: [],
        reasoningSummary: "Launch sequence depends on the first market.",
        roundCount: 1,
        maxRounds: 2,
      },
    );

    const blockedState = applyClarificationResult(state, {
      status: "needs_clarification",
      readyToProceed: false,
      questions: [{ id: "market", question: "Which market launches first?" }],
      missingInformation: ["market"],
      answeredInformation: [],
      reasoningSummary: "The launch market is still missing.",
      roundCount: 2,
      maxRounds: 2,
    });

    const decision = resolveClarificationGate({
      isNewRequest: false,
      request: "Launch the product.",
      state: blockedState,
    });

    expect(blockedState.status).toBe("blocked");
    expect(blockedState.readyToProceed).toBeFalse();
    expect(decision.phase).toBe("blocked");
    expect(decision.canPlan).toBeFalse();
    expect(decision.canDelegate).toBeFalse();
    expect(decision.canFinalize).toBeFalse();
  });

  it("routes ready clarified generative UI requests to product generation before execution", () => {
    const state = applyClarificationResult(createClarificationState("Build product cards."), {
      status: "ready_to_proceed",
      readyToProceed: true,
      questions: [],
      missingInformation: [],
      answeredInformation: [{ key: "audience", value: "developers" }],
      reasoningSummary: "The product request is sufficiently scoped.",
      roundCount: 1,
      maxRounds: 2,
    });

    const decision = resolveClarificationGate({
      isNewRequest: false,
      request: "Build product cards.",
      state,
      generativeUiEnabled: true,
    });

    expect(decision.phase).toBe("product_generation");
    expect(decision.requiredSubagent).toBe("product-generator");
    expect(decision.canPlan).toBeFalse();
    expect(decision.canDelegate).toBeTrue();
    expect(decision.canFinalize).toBeFalse();
  });

  it("routes stale approved reviews without a product batch to product generation", () => {
    const state = applyClarificationResult(createClarificationState("Build product cards."), {
      status: "ready_to_proceed",
      readyToProceed: true,
      questions: [],
      missingInformation: [],
      answeredInformation: [{ key: "audience", value: "developers" }],
      reasoningSummary: "The product request is sufficiently scoped.",
      roundCount: 1,
      maxRounds: 2,
    });

    const decision = resolveClarificationGate({
      isNewRequest: false,
      request: "Build product cards.",
      state,
      generativeUiEnabled: true,
      productBatchGenerated: false,
      reviewStatus: "approved",
    });

    expect(decision.phase).toBe("product_generation");
    expect(decision.requiredSubagent).toBe("product-generator");
    expect(decision.canFinalize).toBeFalse();
  });

  it("routes generated product batches to review before execution", () => {
    const state = applyClarificationResult(createClarificationState("Build product cards."), {
      status: "ready_to_proceed",
      readyToProceed: true,
      questions: [],
      missingInformation: [],
      answeredInformation: [{ key: "audience", value: "developers" }],
      reasoningSummary: "The product request is sufficiently scoped.",
      roundCount: 1,
      maxRounds: 2,
    });

    const decision = resolveClarificationGate({
      isNewRequest: false,
      request: "Build product cards.",
      state,
      generativeUiEnabled: true,
      productBatchGenerated: true,
    });

    expect(decision.phase).toBe("review");
    expect(decision.requiredSubagent).toBe("review-agent");
    expect(decision.canPlan).toBeFalse();
    expect(decision.canDelegate).toBeTrue();
    expect(decision.canFinalize).toBeFalse();
  });

  it("unlocks execution after review approval", () => {
    const state = applyClarificationResult(createClarificationState("Build product cards."), {
      status: "ready_to_proceed",
      readyToProceed: true,
      questions: [],
      missingInformation: [],
      answeredInformation: [{ key: "audience", value: "developers" }],
      reasoningSummary: "The product request is sufficiently scoped.",
      roundCount: 1,
      maxRounds: 2,
    });

    const decision = resolveClarificationGate({
      isNewRequest: false,
      request: "Build product cards.",
      state,
      generativeUiEnabled: true,
      productBatchGenerated: true,
      reviewStatus: "approved",
    });

    expect(decision.phase).toBe("execution");
    expect(decision.requiredSubagent).toBeUndefined();
    expect(decision.canPlan).toBeTrue();
    expect(decision.canDelegate).toBeTrue();
    expect(decision.canFinalize).toBeTrue();
  });

  it("blocks execution when review blocks a generated product batch", () => {
    const state = applyClarificationResult(createClarificationState("Build product cards."), {
      status: "ready_to_proceed",
      readyToProceed: true,
      questions: [],
      missingInformation: [],
      answeredInformation: [{ key: "audience", value: "developers" }],
      reasoningSummary: "The product request is sufficiently scoped.",
      roundCount: 1,
      maxRounds: 2,
    });

    const decision = resolveClarificationGate({
      isNewRequest: false,
      request: "Build product cards.",
      state,
      generativeUiEnabled: true,
      productBatchGenerated: true,
      reviewStatus: "blocked",
      reviewFeedback: "Cannot validate product requirements.",
    });

    expect(decision.phase).toBe("blocked");
    expect(decision.reviewFeedback).toBe("Cannot validate product requirements.");
    expect(decision.canPlan).toBeFalse();
    expect(decision.canDelegate).toBeFalse();
    expect(decision.canFinalize).toBeFalse();
  });

  it("routes reviewer changes back to product generation with feedback", () => {
    const state = applyClarificationResult(createClarificationState("Build product cards."), {
      status: "ready_to_proceed",
      readyToProceed: true,
      questions: [],
      missingInformation: [],
      answeredInformation: [{ key: "audience", value: "developers" }],
      reasoningSummary: "The product request is sufficiently scoped.",
      roundCount: 1,
      maxRounds: 2,
    });

    const decision = resolveClarificationGate({
      isNewRequest: false,
      request: "Build product cards.",
      state,
      generativeUiEnabled: true,
      productBatchGenerated: true,
      reviewStatus: "changes_required",
      reviewFeedback: "Make the cards more actionable.",
    });

    expect(decision.phase).toBe("product_generation");
    expect(decision.requiredSubagent).toBe("product-generator");
    expect(decision.reviewFeedback).toBe("Make the cards more actionable.");
    expect(decision.canPlan).toBeFalse();
    expect(decision.canDelegate).toBeTrue();
    expect(decision.canFinalize).toBeFalse();
  });
});
