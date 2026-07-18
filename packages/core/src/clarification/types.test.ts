import { describe, expect, it } from "bun:test";

import { clarificationResultSchema } from "./types.ts";

describe("clarification result schema", () => {
  const validResult = {
    status: "needs_clarification",
    readyToProceed: false,
    questions: [{ id: "platform", question: "Which platform should this ship on first?" }],
    missingInformation: ["platform"],
    answeredInformation: [],
    reasoningSummary: "Platform choice changes the implementation path.",
    roundCount: 1,
    maxRounds: 10,
  } as const;

  it("parses a valid clarifier payload", () => {
    const parsed = clarificationResultSchema.parse(validResult);

    expect(parsed.status).toBe("needs_clarification");
    expect(parsed.questions).toHaveLength(1);
  });

  it("parses questions with optional structured choices", () => {
    const parsed = clarificationResultSchema.parse({
      ...validResult,
      questions: [
        {
          id: "platform",
          question: "Which platform should this ship on first?",
          options: [
            {
              label: "Web",
              description: "Ship the browser experience first.",
              recommended: true,
            },
            {
              label: "Mobile",
              description: "Prioritize native mobile applications.",
            },
          ],
        },
      ],
    });

    expect(parsed.questions[0]?.options).toEqual([
      {
        label: "Web",
        description: "Ship the browser experience first.",
        recommended: true,
      },
      {
        label: "Mobile",
        description: "Prioritize native mobile applications.",
      },
    ]);
  });

  it("rejects option sets outside the supported size", () => {
    const question = validResult.questions[0];

    expect(() =>
      clarificationResultSchema.parse({
        ...validResult,
        questions: [
          {
            ...question,
            options: [{ label: "Web", description: "Ship the browser experience first." }],
          },
        ],
      }),
    ).toThrow();

    expect(() =>
      clarificationResultSchema.parse({
        ...validResult,
        questions: [
          {
            ...question,
            options: [
              { label: "One", description: "First choice." },
              { label: "Two", description: "Second choice." },
              { label: "Three", description: "Third choice." },
              { label: "Four", description: "Fourth choice." },
              { label: "Five", description: "Fifth choice." },
            ],
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects questions with multiple recommended options", () => {
    expect(() =>
      clarificationResultSchema.parse({
        ...validResult,
        questions: [
          {
            ...validResult.questions[0],
            options: [
              {
                label: "Web",
                description: "Ship the browser experience first.",
                recommended: true,
              },
              {
                label: "Mobile",
                description: "Prioritize native mobile applications.",
                recommended: true,
              },
            ],
          },
        ],
      }),
    ).toThrow("Clarification questions can recommend at most one option.");
  });

  it("produces a value assignable to the ClarificationResult domain type", () => {
    const parsed: import("./types.ts").ClarificationResult =
      clarificationResultSchema.parse(validResult);

    expect(parsed.readyToProceed).toBe(false);
  });

  it("rejects payloads with an unknown status", () => {
    expect(() => clarificationResultSchema.parse({ ...validResult, status: "unknown" })).toThrow();
  });

  it("accepts an optional skipReason recording that the clarifier was short-circuited", () => {
    const parsed = clarificationResultSchema.parse({
      ...validResult,
      status: "ready_to_proceed",
      readyToProceed: true,
      questions: [],
      skipReason: "triage_classifier",
    });

    expect(parsed.skipReason).toBe("triage_classifier");
  });

  it("rejects an unknown skipReason literal", () => {
    expect(() =>
      clarificationResultSchema.parse({
        ...validResult,
        skipReason: "skipped_skipped",
      }),
    ).toThrow();
  });

  it("rejects payloads that omit required fields", () => {
    const { roundCount, ...missingRoundCount } = validResult;

    expect(() => clarificationResultSchema.parse(missingRoundCount)).toThrow();
    void roundCount;
  });
});
