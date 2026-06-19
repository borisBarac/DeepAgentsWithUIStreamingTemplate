import { describe, expect, it } from "bun:test";

import { applyClarificationResult } from "./result.ts";
import {
  archiveClarificationState,
  clearClarificationState,
  createClarificationState,
  recordClarificationAnswers,
  selectUserFacingQuestions,
} from "./state.ts";

describe("user-facing question selection", () => {
  it("returns the exact question texts when clarification is needed", () => {
    const questions = selectUserFacingQuestions({
      status: "needs_clarification",
      readyToProceed: false,
      questions: [
        { id: "platform", question: "Which platform ships first?", context: "affects sequencing" },
        { id: "deadline", question: "What deadline should we hit?" },
      ],
      missingInformation: ["platform", "deadline"],
      answeredInformation: [],
      reasoningSummary: "Both materially change the plan.",
      roundCount: 1,
      maxRounds: 10,
    });

    expect(questions).toEqual(["Which platform ships first?", "What deadline should we hit?"]);
  });

  it("returns no questions once the request is ready to proceed", () => {
    const questions = selectUserFacingQuestions({
      status: "ready_to_proceed",
      readyToProceed: true,
      questions: [],
      missingInformation: [],
      answeredInformation: [],
      reasoningSummary: "Sufficiently specified.",
      roundCount: 1,
      maxRounds: 10,
    });

    expect(questions).toEqual([]);
  });

  it("keeps returning plain question text when structured options are present", () => {
    const questions = selectUserFacingQuestions({
      status: "needs_clarification",
      readyToProceed: false,
      questions: [
        {
          id: "platform",
          question: "Which platform ships first?",
          options: [
            { label: "Web", description: "Ship the browser experience first." },
            { label: "Mobile", description: "Ship native mobile applications first." },
          ],
        },
      ],
      missingInformation: ["platform"],
      answeredInformation: [],
      reasoningSummary: "Platform choice changes the implementation path.",
      roundCount: 1,
      maxRounds: 10,
    });

    expect(questions).toEqual(["Which platform ships first?"]);
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
