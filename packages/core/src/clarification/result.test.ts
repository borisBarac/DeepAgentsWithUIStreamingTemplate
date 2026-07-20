import { describe, expect, it } from "bun:test";

import { applyClarificationResult } from "./result.ts";
import { createClarificationState, recordClarificationAnswers } from "./state.ts";

describe("clarification result application", () => {
  it("does not count a ready result as a clarification round", () => {
    const state = applyClarificationResult(
      createClarificationState("What is 2+2?", { maxRounds: 2 }),
      {
        requestKind: "products",
        status: "ready_to_proceed",
        readyToProceed: true,
        questions: [],
        missingInformation: [],
        answeredInformation: [],
        reasoningSummary: "The request is ready for execution.",
        roundCount: 0,
        maxRounds: 2,
      },
    );

    expect(state.roundCount).toBe(0);
    expect(state.status).toBe("ready_to_proceed");
  });

  it("does not count readiness after an answered question batch as another round", () => {
    const firstRound = applyClarificationResult(
      createClarificationState("Create a migration plan.", { maxRounds: 2 }),
      {
        requestKind: "products",
        status: "needs_clarification",
        readyToProceed: false,
        questions: [{ id: "database", question: "Which database is being migrated?" }],
        missingInformation: ["database"],
        answeredInformation: [],
        reasoningSummary: "The database changes the migration path.",
        roundCount: 1,
        maxRounds: 2,
      },
    );

    const ready = applyClarificationResult(firstRound, {
      requestKind: "products",
      status: "ready_to_proceed",
      readyToProceed: true,
      questions: [],
      missingInformation: [],
      answeredInformation: [{ key: "database", value: "postgres" }],
      reasoningSummary: "The request is ready for execution.",
      roundCount: 1,
      maxRounds: 2,
    });

    expect(ready.roundCount).toBe(1);
    expect(ready.status).toBe("ready_to_proceed");
  });

  it("limits each clarification round to a small question batch", () => {
    const state = createClarificationState("Plan the migration.", { maxRounds: 10 });

    expect(() =>
      applyClarificationResult(state, {
        requestKind: "products",
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
      createClarificationState("Create a migration plan.", { maxRounds: 10 }),
      {
        requestKind: "products",
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
        requestKind: "products",
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

  it("preserves question options in clarification state", () => {
    const state = applyClarificationResult(
      createClarificationState("Choose a deployment model.", { maxRounds: 10 }),
      {
        requestKind: "products",
        status: "needs_clarification",
        readyToProceed: false,
        questions: [
          {
            id: "deployment",
            question: "Which deployment model should we use?",
            options: [
              {
                label: "Managed",
                description: "Use a hosted service with lower operational overhead.",
                recommended: true,
              },
              {
                label: "Self-hosted",
                description: "Operate the service within existing infrastructure.",
              },
            ],
          },
        ],
        missingInformation: ["deployment"],
        answeredInformation: [],
        reasoningSummary: "The deployment model changes the implementation path.",
        roundCount: 1,
        maxRounds: 10,
      },
    );

    expect(state.openQuestions[0]?.options).toEqual([
      {
        label: "Managed",
        description: "Use a hosted service with lower operational overhead.",
        recommended: true,
      },
      {
        label: "Self-hosted",
        description: "Operate the service within existing infrastructure.",
      },
    ]);
  });

  it("forces ready_to_proceed when the round cap is reached unresolved", () => {
    const state = applyClarificationResult(
      createClarificationState("Launch the product.", { maxRounds: 2 }),
      {
        requestKind: "products",
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

    const cappedState = applyClarificationResult(state, {
      requestKind: "products",
      status: "needs_clarification",
      readyToProceed: false,
      questions: [{ id: "market", question: "Which market launches first?" }],
      missingInformation: ["market"],
      answeredInformation: [],
      reasoningSummary: "The launch market is still missing.",
      roundCount: 2,
      maxRounds: 2,
    });

    expect(cappedState.status).toBe("ready_to_proceed");
    expect(cappedState.readyToProceed).toBeTrue();
    expect(cappedState.openQuestions).toEqual([]);
    expect(cappedState.missingInformation).toEqual([]);
  });

  it("preserves supplied answers when forcing ready_to_proceed at the cap", () => {
    const state = applyClarificationResult(
      createClarificationState("Launch the product.", { maxRounds: 2 }),
      {
        requestKind: "products",
        status: "needs_clarification",
        readyToProceed: false,
        questions: [{ id: "market", question: "Which market launches first?" }],
        missingInformation: ["market"],
        answeredInformation: [{ key: "budget", value: "unlimited" }],
        reasoningSummary: "Budget confirmed, market still open.",
        roundCount: 1,
        maxRounds: 2,
      },
    );

    const cappedState = applyClarificationResult(state, {
      requestKind: "products",
      status: "needs_clarification",
      readyToProceed: false,
      questions: [{ id: "market", question: "Which market launches first?" }],
      missingInformation: ["market"],
      answeredInformation: [{ key: "budget", value: "unlimited" }],
      reasoningSummary: "The launch market is still missing.",
      roundCount: 2,
      maxRounds: 2,
    });

    expect(cappedState.status).toBe("ready_to_proceed");
    expect(cappedState.answeredInformation).toEqual([{ key: "budget", value: "unlimited" }]);
  });

  it("preserves explicit blocked results before the round cap", () => {
    const state = applyClarificationResult(
      createClarificationState("Launch the product.", { maxRounds: 10 }),
      {
        requestKind: "products",
        status: "blocked",
        readyToProceed: false,
        questions: [],
        missingInformation: ["market"],
        answeredInformation: [],
        reasoningSummary: "The request cannot be safely executed.",
        roundCount: 1,
        maxRounds: 10,
      },
    );

    expect(state.status).toBe("blocked");
    expect(state.readyToProceed).toBeFalse();
  });

  it("lets the round cap override a blocked result", () => {
    const state = applyClarificationResult(
      createClarificationState("Launch the product.", { maxRounds: 1 }),
      {
        requestKind: "products",
        status: "blocked",
        readyToProceed: false,
        questions: [],
        missingInformation: ["market"],
        answeredInformation: [],
        reasoningSummary: "The launch market is still missing.",
        roundCount: 1,
        maxRounds: 1,
      },
    );

    expect(state.status).toBe("ready_to_proceed");
    expect(state.readyToProceed).toBeTrue();
  });
});
