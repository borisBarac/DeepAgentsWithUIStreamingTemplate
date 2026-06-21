import { describe, expect, it } from "bun:test";

import { createClarificationState } from "../clarification/index.ts";
import type { OrchestratedDeepAgentState } from "./index.ts";
import { createOrchestratedDeepAgentGraph } from "./index.ts";
import {
  APPROVED_REVIEW,
  BLOCKED_REVIEW,
  CHANGES_REQUIRED_REVIEW,
  createMockAgent,
  createReviewAgent,
  invokeInput,
  noClarificationOptions,
} from "./test-helpers.ts";

describe("createOrchestratedDeepAgentGraph review finalization gate", () => {
  it("supplies conversation history and the complete state draft to an injected finalizer", async () => {
    const finalizer = createMockAgent("refined answer");
    const reviewer = createReviewAgent(APPROVED_REVIEW);
    const clarification = {
      ...createClarificationState("draft"),
      answeredInformation: [{ key: "audience", value: "operators" }],
      status: "ready_to_proceed" as const,
      readyToProceed: true,
    };
    const graph = createOrchestratedDeepAgentGraph({
      ...noClarificationOptions(),
      routing: { enableResearch: false, enableCoding: false },
      agents: { finalizer: finalizer.agent, reviewer: reviewer.agent },
    });

    await graph.invoke(
      invokeInput("draft", {
        messages: [{ role: "user", content: "Keep it concise." }],
        clarification,
        researchResult: "research",
        codeResult: "implementation",
        errors: [
          {
            node: "researcher",
            category: "tool",
            message: "source unavailable",
            retryCount: 0,
            required: false,
          },
        ],
      }),
    );

    expect(finalizer.calls[0]?.messages).toEqual(
      expect.arrayContaining([{ role: "user", content: "Keep it concise." }]),
    );
    const finalizerInput = finalizer.calls[0]?.messages
      .map((message) => message.content)
      .join("\n");
    expect(finalizerInput).toContain("## Clarifications\n- audience: operators");
    expect(finalizerInput).toContain("## Research\nresearch");
    expect(finalizerInput).toContain("## Implementation\nimplementation");
    expect(finalizerInput).not.toContain("Debate");
    expect(finalizerInput).not.toContain("Judgment");
    expect(finalizerInput).toContain("## Caveats\n- [tool] researcher: source unavailable");
  });

  it("finalizes the candidate unchanged when review approves", async () => {
    const reviewer = createReviewAgent(APPROVED_REVIEW);
    const graph = createOrchestratedDeepAgentGraph({
      ...noClarificationOptions(),
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
      ...noClarificationOptions(),
      routing: { enableResearch: false, enableCoding: false },
      agents: { reviewer: reviewer.agent },
    });

    (await graph.invoke(invokeInput("summarize the report"))) as OrchestratedDeepAgentState;

    const reviewInput = reviewer.calls[0]?.messages.map((m) => m.content).join("\n") ?? "";
    expect(reviewInput).toContain("Original user request:\nsummarize the report");
    expect(reviewInput).toContain("Candidate:\nsummarize the report");
  });

  it("supplies the complete accumulated state to the reviewer", async () => {
    const reviewer = createReviewAgent(APPROVED_REVIEW);
    const clarification = {
      ...createClarificationState("summarize the report"),
      answeredInformation: [{ key: "format", value: "brief" }],
      status: "ready_to_proceed" as const,
      readyToProceed: true,
    };
    const graph = createOrchestratedDeepAgentGraph({
      ...noClarificationOptions(),
      routing: { enableResearch: false, enableCoding: false },
      agents: { reviewer: reviewer.agent },
    });

    await graph.invoke(
      invokeInput("summarize the report", {
        messages: [
          { role: "user", content: "Focus on operational risk." },
          { role: "assistant", content: "I will prioritize operational risk." },
        ],
        clarification,
        researchResult: "research",
        codeResult: "implementation",
        errors: [
          {
            node: "coder",
            category: "validation",
            message: "example omitted",
            retryCount: 0,
            required: false,
          },
        ],
      }),
    );

    const reviewMessages = reviewer.calls[0]?.messages ?? [];
    expect(reviewMessages).toEqual(
      expect.arrayContaining([
        { role: "user", content: "Focus on operational risk." },
        { role: "assistant", content: "I will prioritize operational risk." },
      ]),
    );
    const reviewInput = reviewMessages.map((message) => message.content).join("\n");
    expect(reviewInput).toContain("Clarifications provided:\n- format: brief");
    expect(reviewInput).toContain("Research performed:\nresearch");
    expect(reviewInput).toContain("Implementation notes:\nimplementation");
    expect(reviewInput).not.toContain("Debate output");
    expect(reviewInput).not.toContain("Judgment");
    expect(reviewInput).toContain("Known limitations:\n- [validation] coder: example omitted");
  });

  it("finalizes with explicit caveats when review is blocked", async () => {
    const reviewer = createReviewAgent(BLOCKED_REVIEW);
    const graph = createOrchestratedDeepAgentGraph({
      ...noClarificationOptions(),
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
      ...noClarificationOptions(),
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
      ...noClarificationOptions(),
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
      ...noClarificationOptions(),
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
      ...noClarificationOptions(),
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
      ...noClarificationOptions(),
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
      ...noClarificationOptions(),
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
