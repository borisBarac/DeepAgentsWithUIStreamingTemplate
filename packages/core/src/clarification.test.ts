import { describe, expect, it } from "bun:test";

import {
  applyClarificationResult,
  archiveClarificationState,
  clearClarificationState,
  createClarificationConfig,
  createClarificationState,
  recordClarificationAnswers,
  resolveClarificationGate,
} from "./clarification";

describe("clarification defaults", () => {
  it("enables mandatory clarification preflight by default", () => {
    expect(createClarificationConfig()).toEqual({
      enabled: true,
      maxRounds: 10,
      questionsPerRound: 3,
      mode: "mandatory-preflight",
    });
  });
});

describe("clarification orchestration", () => {
  it("sends every new user request into clarification first", () => {
    const decision = resolveClarificationGate({
      isNewRequest: true,
      request: "Build a dashboard for the Q2 launch.",
    });

    expect(decision.phase).toBe("clarification");
    expect(decision.shouldDelegateToClarifier).toBeTrue();
    expect(decision.canPlan).toBeFalse();
    expect(decision.canDelegate).toBeFalse();
    expect(decision.state?.originalRequest).toBe("Build a dashboard for the Q2 launch.");
  });

  it("keeps planning and delegation blocked while clarification is unresolved", () => {
    const state = applyClarificationResult(createClarificationState("Ship the feature."), {
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
    });

    const decision = resolveClarificationGate({
      isNewRequest: false,
      request: "Ship the feature.",
      state,
    });

    expect(decision.phase).toBe("clarification");
    expect(decision.shouldDelegateToClarifier).toBeTrue();
    expect(decision.canPlan).toBeFalse();
    expect(decision.canDelegate).toBeFalse();
  });

  it("unlocks normal execution once clarification is ready", () => {
    const state = applyClarificationResult(createClarificationState("Ship the feature."), {
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
    });

    const decision = resolveClarificationGate({
      isNewRequest: false,
      request: "Ship the feature.",
      state,
    });

    expect(decision.phase).toBe("execution");
    expect(decision.shouldDelegateToClarifier).toBeFalse();
    expect(decision.canPlan).toBeTrue();
    expect(decision.canDelegate).toBeTrue();
  });

  it("limits each clarification round to a small question batch", () => {
    const state = createClarificationState("Plan the migration.");

    expect(() =>
      applyClarificationResult(state, {
        status: "needs_clarification",
        readyToProceed: false,
        questions: [
          { id: "target", question: "What is the target platform?" },
          { id: "deadline", question: "What is the deadline?" },
          { id: "budget", question: "What budget is available?" },
          { id: "owners", question: "Who will own rollout?" },
        ],
        missingInformation: ["target", "deadline", "budget", "owners"],
        answeredInformation: [],
        reasoningSummary: "Too many high-impact variables remain open.",
        roundCount: 1,
        maxRounds: 10,
      }),
    ).toThrow("Clarification question batches cannot exceed 3 questions per round.");
  });

  it("increments rounds across follow-up turns", () => {
    const firstRound = applyClarificationResult(
      createClarificationState("Create a migration plan."),
      {
        status: "needs_clarification",
        readyToProceed: false,
        questions: [{ id: "database", question: "Which database is being migrated?" }],
        missingInformation: ["database"],
        answeredInformation: [],
        reasoningSummary: "Database choice changes the migration path.",
        roundCount: 1,
        maxRounds: 10,
      },
    );

    const secondRound = applyClarificationResult(
      recordClarificationAnswers(firstRound, [{ key: "database", value: "postgres" }]),
      {
        status: "needs_clarification",
        readyToProceed: false,
        questions: [{ id: "downtime", question: "Is any downtime acceptable?" }],
        missingInformation: ["downtime"],
        answeredInformation: [{ key: "database", value: "postgres" }],
        reasoningSummary: "Downtime tolerance still changes the execution plan.",
        roundCount: 2,
        maxRounds: 10,
      },
    );

    expect(secondRound.roundCount).toBe(2);
    expect(secondRound.answeredInformation).toEqual([{ key: "database", value: "postgres" }]);
    expect(secondRound.openQuestions).toEqual([
      { id: "downtime", question: "Is any downtime acceptable?" },
    ]);
  });

  it("returns a blocked clarification state when the round cap is reached unresolved", () => {
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
  });
});

describe("clarification state management", () => {
  it("persists answered questions and shrinks open questions as answers arrive", () => {
    const state = applyClarificationResult(createClarificationState("Prepare a rollout plan."), {
      status: "needs_clarification",
      readyToProceed: false,
      questions: [
        { id: "region", question: "Which region rolls out first?" },
        { id: "team", question: "Which team owns the rollout?" },
      ],
      missingInformation: ["region", "team"],
      answeredInformation: [],
      reasoningSummary: "Owner and region both affect sequencing.",
      roundCount: 1,
      maxRounds: 10,
    });

    const updatedState = recordClarificationAnswers(state, [{ key: "region", value: "us-east-1" }]);

    expect(updatedState.answeredInformation).toEqual([{ key: "region", value: "us-east-1" }]);
    expect(updatedState.missingInformation).toEqual(["team"]);
    expect(updatedState.openQuestions).toEqual([
      { id: "team", question: "Which team owns the rollout?" },
    ]);
  });

  it("clears or archives intake state once execution begins", () => {
    const readyState = applyClarificationResult(
      createClarificationState("Prepare a rollout plan."),
      {
        status: "ready_to_proceed",
        readyToProceed: true,
        questions: [],
        missingInformation: [],
        answeredInformation: [{ key: "team", value: "platform" }],
        reasoningSummary: "The request is sufficiently specified.",
        roundCount: 1,
        maxRounds: 10,
      },
    );

    expect(clearClarificationState(readyState)).toBeNull();
    expect(archiveClarificationState(readyState)).toEqual({
      ...readyState,
      openQuestions: [],
      archived: true,
    });
  });
});
