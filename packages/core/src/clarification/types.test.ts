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

  it("produces a value assignable to the ClarificationResult domain type", () => {
    const parsed: import("./types.ts").ClarificationResult =
      clarificationResultSchema.parse(validResult);

    expect(parsed.readyToProceed).toBe(false);
  });

  it("rejects payloads with an unknown status", () => {
    expect(() => clarificationResultSchema.parse({ ...validResult, status: "unknown" })).toThrow();
  });

  it("rejects payloads that omit required fields", () => {
    const { roundCount, ...missingRoundCount } = validResult;

    expect(() => clarificationResultSchema.parse(missingRoundCount)).toThrow();
    void roundCount;
  });
});
