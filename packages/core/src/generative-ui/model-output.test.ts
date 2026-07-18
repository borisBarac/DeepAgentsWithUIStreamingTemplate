import { describe, expect, it } from "bun:test";

import { type ModelUiOutput, modelUiOutputSchema, normalizeModelUiOutput } from "./model-output.ts";
import { validateUpdate } from "./validator.ts";

const validComponents = [
  {
    id: "card",
    component: "Card",
    title: "Result",
    children: [],
  },
];

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
        { type: "ui", rootId: "card", components: validComponents },
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

  it("rejects an oversized batch of individually valid updates", () => {
    const components = [
      {
        id: "root",
        component: "Stack",
        children: Array.from({ length: 20 }, (_, index) => `text-${index}`),
      },
      ...Array.from({ length: 20 }, (_, index) => ({
        id: `text-${index}`,
        component: "Text",
        text: "x".repeat(4_000),
      })),
    ];
    const update = { type: "ui" as const, rootId: "root", components };
    const output = { version: 1 as const, updates: [update, update] };

    expect(validateUpdate(update).ok).toBeTrue();
    expect(modelUiOutputSchema.safeParse(output).success).toBeTrue();
    expect(normalizeModelUiOutput(output)).toBeNull();
  });
});
