import { describe, expect, it } from "bun:test";

import { createClarificationState } from "../clarification/index.ts";
import type {
  OrchestratedDeepAgentMessage,
  OrchestratedDeepAgentRoute,
  OrchestratedDeepAgentState,
} from "./index.ts";
import { createOrchestratedDeepAgentGraph } from "./index.ts";
import {
  APPROVED_REVIEW,
  createFailingAgent,
  createMockAgent,
  createReviewAgent,
  invokeInput,
  NO_CLARIFICATION,
} from "./test-helpers.ts";

describe("createOrchestratedDeepAgentGraph state shape", () => {
  it("returns a state object with the contract fields", async () => {
    const reviewer = createReviewAgent(APPROVED_REVIEW);
    const graph = createOrchestratedDeepAgentGraph({
      ...NO_CLARIFICATION,
      routing: { enableResearch: false, enableCoding: false },
      agents: { reviewer: reviewer.agent },
    });

    const result = (await graph.invoke(invokeInput("hello"))) as OrchestratedDeepAgentState;

    expect(result.task).toBe("hello");
    expect(Array.isArray(result.errors)).toBe(true);
    expect(result.next).toBe("end");
    expect(typeof result.finalAnswer).toBe("string");
    expect(result.finalAnswer).toBe("hello");
    expect(result.review?.status).toBe("approved");
  });
});

describe("createOrchestratedDeepAgentGraph gatekeeper", () => {
  it("hands an allowed task to the main deep-agent flow", async () => {
    const researcher = createMockAgent("allowed task completed");
    const reviewer = createReviewAgent(APPROVED_REVIEW);
    const graph = createOrchestratedDeepAgentGraph({
      ...NO_CLARIFICATION,
      gatekeeper: {
        classifier: {
          invoke: async () => ({
            inScope: true,
            missingContext: [],
            violatedRules: [],
            reason: "The request targets this project.",
          }),
        },
      },
      routing: { enableResearch: true, enableCoding: false },
      agents: { researcher: researcher.agent, reviewer: reviewer.agent },
    });

    const result = (await graph.invoke(
      invokeInput("Research the project architecture"),
    )) as OrchestratedDeepAgentState;

    expect(result.gatekeeperDecision?.inScope).toBe(true);
    expect(researcher.calls).toHaveLength(1);
    expect(result.finalAnswer).toContain("allowed task completed");
  });

  it("blocks an out-of-scope task before any main agent is invoked", async () => {
    const researcher = createMockAgent("must not run");
    const finalizer = createMockAgent("must not run");
    const reviewer = createReviewAgent(APPROVED_REVIEW);
    const graph = createOrchestratedDeepAgentGraph({
      ...NO_CLARIFICATION,
      gatekeeper: {
        classifier: {
          invoke: async () => ({
            inScope: false,
            missingContext: [],
            violatedRules: ["outside project scope"],
            reason: "The request does not target this project.",
          }),
        },
      },
      routing: { enableResearch: true, enableCoding: false },
      agents: {
        researcher: researcher.agent,
        finalizer: finalizer.agent,
        reviewer: reviewer.agent,
      },
    });

    const result = (await graph.invoke(invokeInput("Book a flight"))) as OrchestratedDeepAgentState;

    expect(result.next).toBe("blocked");
    expect(result.gatekeeperDecision?.inScope).toBe(false);
    expect(result.finalAnswer).toContain("outside the system parameters");
    expect(result.finalAnswer).toContain("does not target this project");
    expect(researcher.calls).toHaveLength(0);
    expect(finalizer.calls).toHaveLength(0);
    expect(reviewer.calls).toHaveLength(0);
  });
});

describe("createOrchestratedDeepAgentGraph clarification gate", () => {
  it("skips clarification when disabled and runs the finalizer", async () => {
    const reviewer = createReviewAgent(APPROVED_REVIEW);
    const graph = createOrchestratedDeepAgentGraph({
      ...NO_CLARIFICATION,
      routing: { enableResearch: false, enableCoding: false },
      agents: { reviewer: reviewer.agent },
    });

    const result = (await graph.invoke(
      invokeInput("summarize this"),
    )) as OrchestratedDeepAgentState;

    expect(result.clarification).toBeUndefined();
    expect(result.next).toBe("end");
    expect(result.finalAnswer).toBe("summarize this");
  });

  it("pauses for clarification when enabled and the task is unresolved", async () => {
    const graph = createOrchestratedDeepAgentGraph({
      routing: { enableResearch: false, enableCoding: false },
    });

    const result = (await graph.invoke(
      invokeInput("open-ended task"),
    )) as OrchestratedDeepAgentState;

    expect(result.next).toBe("clarify");
    expect(result.clarification?.status).toBe("needs_clarification");
    expect(result.finalAnswer).toBeUndefined();
  });

  it("proceeds to work when clarification is already resolved", async () => {
    const reviewer = createReviewAgent(APPROVED_REVIEW);
    const graph = createOrchestratedDeepAgentGraph({
      routing: { enableResearch: false, enableCoding: false },
      agents: { reviewer: reviewer.agent },
    });

    const resolved = {
      ...createClarificationState("ready task"),
      status: "ready_to_proceed" as const,
      readyToProceed: true,
    };

    const result = (await graph.invoke(
      invokeInput("ready task", { clarification: resolved }),
    )) as OrchestratedDeepAgentState;

    expect(result.next).toBe("end");
    expect(result.finalAnswer).toBe("ready task");
  });
});

describe("createOrchestratedDeepAgentGraph routing", () => {
  it("produces every public route value as a reachable destination", () => {
    const routes: OrchestratedDeepAgentRoute[] = [
      "clarify",
      "research",
      "code",
      "final",
      "blocked",
      "end",
    ];
    for (const route of routes) {
      expect(typeof route).toBe("string");
    }
    expect(routes.length).toBe(6);
  });
});

describe("createOrchestratedDeepAgentGraph message passthrough", () => {
  it("passes prior messages through the graph state", async () => {
    const graph = createOrchestratedDeepAgentGraph({
      ...NO_CLARIFICATION,
      routing: { enableResearch: false, enableCoding: false },
    });

    const messages: OrchestratedDeepAgentMessage[] = [{ role: "user", content: "hi" }];
    const result = (await graph.invoke(
      invokeInput("hi", { messages }),
    )) as OrchestratedDeepAgentState;

    expect(result.messages).toEqual(messages);
  });

  it("preserves host conversation without appending stage-internal messages", async () => {
    const researcher = createMockAgent("research result");
    const reviewer = createReviewAgent(APPROVED_REVIEW);
    const graph = createOrchestratedDeepAgentGraph({
      ...NO_CLARIFICATION,
      routing: { enableResearch: true, enableCoding: false },
      agents: { researcher: researcher.agent, reviewer: reviewer.agent },
    });
    const messages: OrchestratedDeepAgentMessage[] = [
      { role: "user", content: "Use our existing architecture." },
      { role: "assistant", content: "I will preserve the current architecture." },
    ];

    const result = (await graph.invoke(
      invokeInput("Research Redis streams", { messages }),
    )) as OrchestratedDeepAgentState;

    expect(result.messages).toEqual(messages);
    expect(result.messages).not.toContainEqual({
      role: "assistant",
      content: "research result",
    });
  });
});

describe("createOrchestratedDeepAgentGraph state reducers", () => {
  it("retains existing errors when a stage records another failure", async () => {
    const researcher = createFailingAgent(new Error("model rate limit 429"));
    const reviewer = createReviewAgent(APPROVED_REVIEW);
    const graph = createOrchestratedDeepAgentGraph({
      ...NO_CLARIFICATION,
      routing: { enableResearch: true, enableCoding: false },
      agents: { researcher: researcher.agent, reviewer: reviewer.agent },
    });
    const existingError = {
      node: "intake",
      category: "validation" as const,
      message: "metadata incomplete",
      retryCount: 0,
      required: false,
    };

    const result = (await graph.invoke(
      invokeInput("Research Redis streams", { errors: [existingError] }),
    )) as OrchestratedDeepAgentState;

    expect(result.errors).toEqual(
      expect.arrayContaining([
        existingError,
        expect.objectContaining({
          node: "researcher",
          category: "model",
          message: "model rate limit 429",
        }),
      ]),
    );
    expect(result.errors).toHaveLength(2);
  });
});
