import { describe, expect, it } from "bun:test";

import {
  applyClarificationResult,
  type ClarificationState,
  createOrchestratedDeepAgentGraph,
  type OrchestratedDeepAgent,
  type OrchestratedDeepAgentInvokeInput,
  type OrchestratedDeepAgentState,
  type ReviewReport,
} from "../src/index.ts";

const APPROVED_REVIEW: ReviewReport = {
  status: "approved",
  score: 100,
  criticalIssues: [],
  majorIssues: [],
  minorIssues: [],
  requiredChanges: [],
  finalRecommendation: "ready to deliver",
};

function createRecordingAgent(response: string): {
  agent: OrchestratedDeepAgent;
  calls: OrchestratedDeepAgentInvokeInput[];
} {
  const calls: OrchestratedDeepAgentInvokeInput[] = [];
  return {
    calls,
    agent: {
      invoke: async (input) => {
        calls.push(input);
        return {
          messages: [...input.messages, { role: "assistant", content: response }],
        };
      },
    },
  };
}

function createReviewer(): ReturnType<typeof createRecordingAgent> {
  return createRecordingAgent(JSON.stringify(APPROVED_REVIEW));
}

function initialState(task: string): OrchestratedDeepAgentState {
  return {
    task,
    messages: [],
    next: "final",
    errors: [],
  };
}

function requireClarification(state: OrchestratedDeepAgentState): ClarificationState {
  if (!state.clarification) {
    throw new Error("Expected the graph to return clarification state.");
  }
  return state.clarification;
}

describe("clarification integration", () => {
  it("pauses a new request and resumes execution with resolved clarification answers", async () => {
    const finalizer = createRecordingAgent("Implementation plan completed.");
    const reviewer = createReviewer();
    const graph = createOrchestratedDeepAgentGraph({
      routing: { enableResearch: false, enableCoding: false },
      agents: {
        finalizer: finalizer.agent,
        reviewer: reviewer.agent,
      },
    });

    const paused = (await graph.invoke(
      initialState("Create an implementation plan."),
    )) as OrchestratedDeepAgentState;

    expect(paused.next).toBe("clarify");
    expect(paused.clarification?.status).toBe("needs_clarification");
    expect(finalizer.calls).toHaveLength(0);
    expect(reviewer.calls).toHaveLength(0);

    const pausedClarification = requireClarification(paused);
    const clarification = applyClarificationResult(pausedClarification, {
      status: "ready_to_proceed",
      readyToProceed: true,
      questions: [],
      missingInformation: [],
      answeredInformation: [{ key: "target", value: "Bun CLI" }],
      reasoningSummary: "The target runtime is now explicit.",
      roundCount: 1,
      maxRounds: pausedClarification.maxRounds,
    });

    const completed = (await graph.invoke({
      ...paused,
      clarification,
    })) as OrchestratedDeepAgentState;

    expect(completed.next).toBe("end");
    expect(completed.finalAnswer).toBe("Implementation plan completed.");
    expect(finalizer.calls).toHaveLength(1);
    expect(finalizer.calls[0]?.messages.at(-1)?.content).toContain(
      "## Clarifications\n- target: Bun CLI",
    );
    expect(reviewer.calls).toHaveLength(1);
  });

  it("remains paused when a clarification round leaves required information unresolved", async () => {
    const finalizer = createRecordingAgent("must not run");
    const reviewer = createReviewer();
    const graph = createOrchestratedDeepAgentGraph({
      routing: { enableResearch: false, enableCoding: false },
      agents: {
        finalizer: finalizer.agent,
        reviewer: reviewer.agent,
      },
    });

    const firstPause = (await graph.invoke(
      initialState("Create an implementation plan."),
    )) as OrchestratedDeepAgentState;
    const firstClarification = requireClarification(firstPause);
    const unresolvedClarification = applyClarificationResult(firstClarification, {
      status: "needs_clarification",
      readyToProceed: false,
      questions: [{ id: "target", question: "What runtime should the plan target?" }],
      missingInformation: ["target"],
      answeredInformation: [],
      reasoningSummary: "The target runtime changes the implementation plan.",
      roundCount: 1,
      maxRounds: firstClarification.maxRounds,
    });

    const secondPause = (await graph.invoke({
      ...firstPause,
      clarification: unresolvedClarification,
    })) as OrchestratedDeepAgentState;

    expect(secondPause.next).toBe("clarify");
    expect(secondPause.finalAnswer).toBeUndefined();
    expect(secondPause.clarification).toMatchObject({
      status: "needs_clarification",
      roundCount: 1,
      missingInformation: ["target"],
      openQuestions: [{ id: "target", question: "What runtime should the plan target?" }],
    });
    expect(finalizer.calls).toHaveLength(0);
    expect(reviewer.calls).toHaveLength(0);
  });

  it("blocks execution when the final clarification round remains unresolved", async () => {
    const finalizer = createRecordingAgent("must not run");
    const reviewer = createReviewer();
    const graph = createOrchestratedDeepAgentGraph({
      clarification: { maxRounds: 1 },
      routing: { enableResearch: false, enableCoding: false },
      agents: {
        finalizer: finalizer.agent,
        reviewer: reviewer.agent,
      },
    });

    const paused = (await graph.invoke(
      initialState("Create an implementation plan."),
    )) as OrchestratedDeepAgentState;
    const blockedClarification = applyClarificationResult(requireClarification(paused), {
      status: "needs_clarification",
      readyToProceed: false,
      questions: [{ id: "target", question: "What runtime should the plan target?" }],
      missingInformation: ["target"],
      answeredInformation: [],
      reasoningSummary: "The target runtime is still missing.",
      roundCount: 1,
      maxRounds: 1,
    });

    const blocked = (await graph.invoke({
      ...paused,
      clarification: blockedClarification,
    })) as OrchestratedDeepAgentState;

    expect(blocked.next).toBe("blocked");
    expect(blocked.finalAnswer).toBeUndefined();
    expect(blocked.clarification).toMatchObject({
      status: "blocked",
      readyToProceed: false,
      roundCount: 1,
      missingInformation: ["target"],
      openQuestions: [],
    });
    expect(finalizer.calls).toHaveLength(0);
    expect(reviewer.calls).toHaveLength(0);
  });
});
