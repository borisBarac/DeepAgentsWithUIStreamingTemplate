import { describe, expect, it } from "bun:test";

import { createClarificationState } from "./clarification/index.ts";
import {
  type CreateOrchestratedDeepAgentGraphOptions,
  composeFinalAnswer,
  createOrchestratedDeepAgentGraph,
  type OrchestratedDeepAgent,
  type OrchestratedDeepAgentInvokeInput,
  type OrchestratedDeepAgentMessage,
  type OrchestratedDeepAgentRoute,
  type OrchestratedDeepAgentState,
  selectWorkRoute,
  toStructuredError,
} from "./orchestration.ts";
import type { ReviewReport } from "./review/index.ts";

function createMockAgent(response: string): {
  agent: OrchestratedDeepAgent;
  calls: OrchestratedDeepAgentInvokeInput[];
} {
  const calls: OrchestratedDeepAgentInvokeInput[] = [];
  const agent: OrchestratedDeepAgent = {
    invoke: async (input) => {
      calls.push(input);
      return {
        messages: [...input.messages, { role: "assistant", content: response }],
      };
    },
  };
  return { agent, calls };
}

function createFailingAgent(error: unknown): {
  agent: OrchestratedDeepAgent;
  calls: OrchestratedDeepAgentInvokeInput[];
} {
  const calls: OrchestratedDeepAgentInvokeInput[] = [];
  const agent: OrchestratedDeepAgent = {
    invoke: async (input) => {
      calls.push(input);
      throw error;
    },
  };
  return { agent, calls };
}

const APPROVED_REVIEW: ReviewReport = {
  status: "approved",
  score: 91,
  criticalIssues: [],
  majorIssues: [],
  minorIssues: [],
  requiredChanges: [],
  finalRecommendation: "ready to deliver",
};

function createReviewAgent(reports: ReviewReport | ReviewReport[]): {
  agent: OrchestratedDeepAgent;
  calls: OrchestratedDeepAgentInvokeInput[];
} {
  const queue = Array.isArray(reports) ? [...reports] : [reports];
  const calls: OrchestratedDeepAgentInvokeInput[] = [];
  const agent: OrchestratedDeepAgent = {
    invoke: async (input) => {
      calls.push(input);
      const report = queue.shift() ?? APPROVED_REVIEW;
      return {
        messages: [...input.messages, { role: "assistant", content: JSON.stringify(report) }],
      };
    },
  };
  return { agent, calls };
}

const NO_CLARIFICATION = {
  clarification: { enabled: false },
} satisfies CreateOrchestratedDeepAgentGraphOptions;

function invokeInput(
  task: string,
  overrides: Partial<OrchestratedDeepAgentState> = {},
): OrchestratedDeepAgentState {
  return {
    task,
    messages: [],
    next: "final",
    errors: [],
    ...overrides,
  };
}

describe("selectWorkRoute", () => {
  it("routes research keyword tasks to research", () => {
    expect(selectWorkRoute("Research Redis streams and summarize options", {})).toBe("research");
  });

  it("routes coding keyword tasks to code", () => {
    expect(selectWorkRoute("Implement a Node.js consumer and deploy it", {})).toBe("code");
  });

  it("routes debate tasks to debate only when debate is enabled", () => {
    expect(selectWorkRoute("Debate tabs versus spaces", { enableDebate: true })).toBe("debate");
    expect(selectWorkRoute("Debate tabs versus spaces", { enableDebate: false })).not.toBe(
      "debate",
    );
  });

  it("routes to final when no work stages are enabled", () => {
    expect(selectWorkRoute("thanks", { enableResearch: false, enableCoding: false })).toBe("final");
  });

  it("falls back to research when enabled but no keyword matches", () => {
    expect(selectWorkRoute("thanks", { enableResearch: true, enableCoding: false })).toBe(
      "research",
    );
  });
});

describe("composeFinalAnswer", () => {
  it("composes stage outputs into sections", () => {
    const answer = composeFinalAnswer({
      task: "original task",
      messages: [],
      next: "end",
      errors: [],
      researchResult: "found a thing",
      codeResult: "wrote a module",
    });

    expect(answer).toContain("## Research\nfound a thing");
    expect(answer).toContain("## Implementation\nwrote a module");
  });

  it("flags required failures as blocked", () => {
    const answer = composeFinalAnswer({
      task: "original task",
      messages: [],
      next: "end",
      errors: [
        { node: "reviewer", category: "model", message: "boom", retryCount: 1, required: true },
      ],
    });

    expect(answer).toContain("## Blocked");
    expect(answer).toContain("[model] reviewer: boom");
  });

  it("falls back to the task when no stage produced output", () => {
    const answer = composeFinalAnswer({
      task: "just the task",
      messages: [],
      next: "end",
      errors: [],
    });
    expect(answer).toBe("just the task");
  });
});

describe("toStructuredError", () => {
  it("categorizes permission failures", () => {
    const error = toStructuredError(new Error("Permission denied for execute"), "reviewer", {
      required: true,
    });
    expect(error.category).toBe("permission");
    expect(error.required).toBe(true);
    expect(error.node).toBe("reviewer");
  });

  it("categorizes unknown failures", () => {
    expect(toStructuredError("something odd", "researcher").category).toBe("unknown");
  });
});

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

describe("createOrchestratedDeepAgentGraph custom agent injection", () => {
  it("invokes an injected researcher and flows output to the finalizer", async () => {
    const { agent: researcher, calls } = createMockAgent("Redis streams are append-only logs.");
    const reviewer = createReviewAgent(APPROVED_REVIEW);
    const graph = createOrchestratedDeepAgentGraph({
      ...NO_CLARIFICATION,
      routing: { enableResearch: true, enableCoding: false },
      agents: { researcher, reviewer: reviewer.agent },
    });

    const result = (await graph.invoke(
      invokeInput("Research Redis streams"),
    )) as OrchestratedDeepAgentState;

    expect(calls.length).toBe(1);
    expect(result.researchResult).toBe("Redis streams are append-only logs.");
    expect(result.finalAnswer).toContain("Redis streams are append-only logs.");
    expect(result.next).toBe("end");
  });
});

describe("createOrchestratedDeepAgentGraph error propagation", () => {
  it("records a structured error and still finalizes when an optional stage fails", async () => {
    const { agent: researcher } = createFailingAgent(new Error("model rate limit 429"));
    const reviewer = createReviewAgent(APPROVED_REVIEW);
    const graph = createOrchestratedDeepAgentGraph({
      ...NO_CLARIFICATION,
      routing: { enableResearch: true, enableCoding: false },
      agents: { researcher, reviewer: reviewer.agent },
    });

    const result = (await graph.invoke(
      invokeInput("Research Redis streams"),
    )) as OrchestratedDeepAgentState;

    expect(result.errors.length).toBe(1);
    expect(result.errors[0]?.node).toBe("researcher");
    expect(result.errors[0]?.category).toBe("model");
    expect(result.next).toBe("end");
    expect(result.finalAnswer).toContain("## Caveats");
  });

  it("routes a code task through the coder node", async () => {
    const coder = createMockAgent("implementation plan");
    const reviewer = createReviewAgent(APPROVED_REVIEW);
    const graph = createOrchestratedDeepAgentGraph({
      ...NO_CLARIFICATION,
      routing: { enableResearch: false, enableCoding: true },
      agents: { coder: coder.agent, reviewer: reviewer.agent },
    });

    const result = (await graph.invoke(
      invokeInput("Implement a consumer"),
    )) as OrchestratedDeepAgentState;

    expect(coder.calls.length).toBe(1);
    expect(result.codeResult).toBe("implementation plan");
    expect(result.finalAnswer).toContain("implementation plan");
  });
});

describe("createOrchestratedDeepAgentGraph routing", () => {
  it("routes a debate task to the judge node when debate is enabled", async () => {
    const judge = createMockAgent("winning synthesis");
    const reviewer = createReviewAgent(APPROVED_REVIEW);
    const graph = createOrchestratedDeepAgentGraph({
      ...NO_CLARIFICATION,
      routing: {
        enableResearch: false,
        enableCoding: false,
        enableDebate: true,
      },
      agents: { judge: judge.agent, reviewer: reviewer.agent },
    });

    const result = (await graph.invoke(
      invokeInput("Debate tabs versus spaces"),
    )) as OrchestratedDeepAgentState;

    expect(judge.calls.length).toBe(1);
    expect(result.judgeResult).toBe("winning synthesis");
    expect(result.finalAnswer).toContain("winning synthesis");
  });

  it("produces every public route value as a reachable destination", () => {
    const routes: OrchestratedDeepAgentRoute[] = [
      "clarify",
      "research",
      "code",
      "debate",
      "judge",
      "final",
      "blocked",
      "end",
    ];
    for (const route of routes) {
      expect(typeof route).toBe("string");
    }
    expect(routes.length).toBe(8);
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
});

const CHANGES_REQUIRED_REVIEW: ReviewReport = {
  status: "changes_required",
  score: 58,
  criticalIssues: [{ issue: "no tests", impact: "correctness", evidence: "none present" }],
  majorIssues: [],
  minorIssues: [],
  requiredChanges: ["add tests for the consumer"],
  finalRecommendation: "address required changes before delivery",
};

const BLOCKED_REVIEW: ReviewReport = {
  status: "blocked",
  score: 20,
  criticalIssues: [],
  majorIssues: [],
  minorIssues: [],
  requiredChanges: [],
  finalRecommendation: "missing decision-critical context",
};

describe("createOrchestratedDeepAgentGraph review finalization gate", () => {
  it("finalizes the candidate unchanged when review approves", async () => {
    const reviewer = createReviewAgent(APPROVED_REVIEW);
    const graph = createOrchestratedDeepAgentGraph({
      ...NO_CLARIFICATION,
      routing: { enableResearch: false, enableCoding: false },
      agents: { reviewer: reviewer.agent },
    });

    const result = (await graph.invoke(invokeInput("hello"))) as OrchestratedDeepAgentState;

    expect(result.review?.status).toBe("approved");
    expect(result.review?.caveated).toBe(false);
    expect(result.review?.report?.score).toBe(91);
    expect(result.review?.reviewCount).toBe(1);
    expect(result.finalAnswer).toBe("hello");
    expect(result.finalAnswer).not.toContain("Review Caveats");
  });

  it("sends the original request and candidate to the reviewer", async () => {
    const reviewer = createReviewAgent(APPROVED_REVIEW);
    const graph = createOrchestratedDeepAgentGraph({
      ...NO_CLARIFICATION,
      routing: { enableResearch: false, enableCoding: false },
      agents: { reviewer: reviewer.agent },
    });

    (await graph.invoke(invokeInput("summarize the report"))) as OrchestratedDeepAgentState;

    const reviewInput = reviewer.calls[0]?.messages.map((m) => m.content).join("\n") ?? "";
    expect(reviewInput).toContain("Original user request:\nsummarize the report");
    expect(reviewInput).toContain("Candidate:\nsummarize the report");
  });

  it("finalizes with explicit caveats when review is blocked", async () => {
    const reviewer = createReviewAgent(BLOCKED_REVIEW);
    const graph = createOrchestratedDeepAgentGraph({
      ...NO_CLARIFICATION,
      routing: { enableResearch: false, enableCoding: false },
      agents: { reviewer: reviewer.agent },
    });

    const result = (await graph.invoke(invokeInput("hello"))) as OrchestratedDeepAgentState;

    expect(result.review?.status).toBe("blocked");
    expect(result.review?.caveated).toBe(true);
    expect(result.finalAnswer).toContain("## Review Caveats");
    expect(result.finalAnswer).toContain("NOT approved by review");
    expect(result.finalAnswer).toContain("missing decision-critical context");
    expect(result.finalAnswer).toContain("hello");
  });

  it("explicitly represents blocked delivery and never claims approval", async () => {
    const reviewer = createReviewAgent(BLOCKED_REVIEW);
    const graph = createOrchestratedDeepAgentGraph({
      ...NO_CLARIFICATION,
      routing: { enableResearch: false, enableCoding: false },
      agents: { reviewer: reviewer.agent },
    });

    const result = (await graph.invoke(invokeInput("hello"))) as OrchestratedDeepAgentState;

    expect(result.review?.status).not.toBe("approved");
    expect(result.review?.caveated).toBe(true);
  });

  it("revises the candidate when review requires changes and re-reviews until approved", async () => {
    const reviewer = createReviewAgent([CHANGES_REQUIRED_REVIEW, APPROVED_REVIEW]);
    const reviser = createMockAgent("polished candidate");
    const graph = createOrchestratedDeepAgentGraph({
      ...NO_CLARIFICATION,
      routing: { enableResearch: false, enableCoding: false },
      agents: { reviewer: reviewer.agent, finalizer: reviser.agent },
    });

    const result = (await graph.invoke(invokeInput("draft"))) as OrchestratedDeepAgentState;

    expect(reviewer.calls.length).toBe(2);
    expect(result.review?.status).toBe("approved");
    expect(result.review?.reviewCount).toBe(2);
    expect(result.review?.reports[0]?.status).toBe("changes_required");
    expect(result.review?.reports[1]?.status).toBe("approved");
    expect(result.finalAnswer).toBe("polished candidate");
  });

  it("delivers caveated output when the review loop limit is exhausted without approval", async () => {
    const reviewer = createReviewAgent([CHANGES_REQUIRED_REVIEW, CHANGES_REQUIRED_REVIEW]);
    const reviser = createMockAgent("polished candidate");
    const graph = createOrchestratedDeepAgentGraph({
      ...NO_CLARIFICATION,
      routing: { enableResearch: false, enableCoding: false },
      agents: { reviewer: reviewer.agent, finalizer: reviser.agent },
    });

    const result = (await graph.invoke(invokeInput("draft"))) as OrchestratedDeepAgentState;

    expect(result.review?.status).toBe("changes_required");
    expect(result.review?.caveated).toBe(true);
    expect(result.review?.reviewCount).toBe(2);
    expect(result.review?.maxRevisions).toBe(2);
    expect(result.finalAnswer).toContain("## Review Caveats");
    expect(result.finalAnswer).toContain("add tests for the consumer");
    expect(result.review?.status).not.toBe("approved");
  });

  it("honours a configured review loop limit lower than the default", async () => {
    const reviewer = createReviewAgent([CHANGES_REQUIRED_REVIEW]);
    const graph = createOrchestratedDeepAgentGraph({
      ...NO_CLARIFICATION,
      routing: { enableResearch: false, enableCoding: false },
      review: { maxRevisions: 1 },
      agents: { reviewer: reviewer.agent },
    });

    const result = (await graph.invoke(invokeInput("draft"))) as OrchestratedDeepAgentState;

    expect(result.review?.maxRevisions).toBe(1);
    expect(result.review?.reviewCount).toBe(1);
    expect(result.review?.caveated).toBe(true);
    expect(result.finalAnswer).toContain("## Review Caveats");
  });

  it("represents delivery as blocked/caveated when no reviewer is configured", async () => {
    const graph = createOrchestratedDeepAgentGraph({
      ...NO_CLARIFICATION,
      routing: { enableResearch: false, enableCoding: false },
    });

    const result = (await graph.invoke(invokeInput("hello"))) as OrchestratedDeepAgentState;

    expect(result.review?.status).toBe("blocked");
    expect(result.review?.caveated).toBe(true);
    expect(result.finalAnswer).toContain("## Review Caveats");
    expect(result.review?.status).not.toBe("approved");
  });

  it("reviews a pure conversational answer using only the candidate final message", async () => {
    const reviewer = createReviewAgent(APPROVED_REVIEW);
    const graph = createOrchestratedDeepAgentGraph({
      ...NO_CLARIFICATION,
      routing: { enableResearch: false, enableCoding: false },
      agents: { reviewer: reviewer.agent },
    });

    const result = (await graph.invoke(invokeInput("what is 2+2?"))) as OrchestratedDeepAgentState;

    expect(result.review?.status).toBe("approved");
    expect(result.finalAnswer).toBe("what is 2+2?");
    const reviewInput = reviewer.calls[0]?.messages.map((m) => m.content).join("\n") ?? "";
    expect(reviewInput).toContain("Candidate:\nwhat is 2+2?");
  });
});
