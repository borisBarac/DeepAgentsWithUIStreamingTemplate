import { describe, expect, it } from "bun:test";

import { type ModelUiOutput, modelUiOutputSchema, normalizeModelUiOutput } from "./model-output.ts";

const validSpec = {
  root: "card",
  elements: {
    card: {
      type: "Card",
      props: { title: "Result" },
      children: [],
      visible: { path: "/showCard" },
    },
  },
};

describe("modelUiOutputSchema", () => {
  it("accepts the versioned message, question, and ui update object", () => {
    const value = {
      version: 1,
      updates: [
        { type: "message", text: "Choose an option." },
        {
          type: "question",
          question: {
            id: "format",
            prompt: "Which format?",
            kind: "multiple_choice",
            options: ["Short", "Detailed"],
          },
        },
        { type: "ui", spec: validSpec },
      ],
    } satisfies ModelUiOutput;

    expect(modelUiOutputSchema.parse(value)).toEqual(value);
    expect(normalizeModelUiOutput(value)).toEqual(value);
  });

  it("rejects host-owned update types", () => {
    for (const update of [
      { type: "error", message: "spoofed" },
      { type: "main_agent_activity", event: "completed" },
      { type: "subagent_activity", subagentName: "reviewer", event: "completed" },
    ]) {
      expect(modelUiOutputSchema.safeParse({ version: 1, updates: [update] }).success).toBeFalse();
    }
  });

  it("rejects wrong versions, empty updates, and unknown fields", () => {
    expect(modelUiOutputSchema.safeParse({ version: 2, updates: [] }).success).toBeFalse();
    expect(modelUiOutputSchema.safeParse({ version: 1, updates: [] }).success).toBeFalse();
    expect(
      modelUiOutputSchema.safeParse({
        version: 1,
        updates: [{ type: "message", text: "Hello", event: "completed" }],
      }).success,
    ).toBeFalse();
    expect(normalizeModelUiOutput({ version: 1, updates: "invalid" })).toBeNull();
  });

  it("rejects oversized update arrays and text", () => {
    const update = { type: "message", text: "ok" };
    expect(
      modelUiOutputSchema.safeParse({ version: 1, updates: Array(33).fill(update) }).success,
    ).toBeFalse();
    expect(
      modelUiOutputSchema.safeParse({
        version: 1,
        updates: [{ type: "message", text: "x".repeat(4_001) }],
      }).success,
    ).toBeFalse();
  });
});
