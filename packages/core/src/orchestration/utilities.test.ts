import { describe, expect, it } from "bun:test";

import { composeFinalAnswer, selectWorkRoute, toStructuredError } from "./index.ts";

describe("selectWorkRoute", () => {
  it("routes research keyword tasks to research", () => {
    expect(selectWorkRoute("Research Redis streams and summarize options", {})).toBe("research");
  });

  it("routes coding keyword tasks to code", () => {
    expect(selectWorkRoute("Implement a Node.js consumer and deploy it", {})).toBe("code");
  });

  it("routes comparison-style tasks through the normal research flow", () => {
    expect(
      selectWorkRoute("Debate tabs versus spaces", { enableResearch: true, enableCoding: false }),
    ).toBe("research");
  });

  it("falls back to final when both work stages are disabled", () => {
    expect(
      selectWorkRoute("Debate tabs versus spaces", {
        enableResearch: false,
        enableCoding: false,
      }),
    ).toBe("final");
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
