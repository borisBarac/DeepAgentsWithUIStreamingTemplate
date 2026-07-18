import { describe, expect, it } from "bun:test";

import { CORE_PROMPT_TEMPLATES } from "../prompts/index.ts";
import {
  type ClarificationTriageClassifier,
  clarificationTriageDecisionSchema,
  classifyClarificationTriage,
  createClarificationTriageClassifier,
  createClarificationTriagePrompt,
  PROCEED_TRIAGE_DECISION,
  TRIAGE_SKIP_REASON,
} from "./triage.ts";

function fakeClassifier(response: unknown): ClarificationTriageClassifier & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    async invoke(input: unknown) {
      calls.push(input);
      return response;
    },
  };
}

describe("clarificationTriageDecisionSchema", () => {
  it("accepts a well-formed skip decision", () => {
    expect(
      clarificationTriageDecisionSchema.parse({
        decision: "skip",
        reason: "Continuation token.",
      }),
    ).toEqual({ decision: "skip", reason: "Continuation token." });
  });

  it("accepts a well-formed proceed decision", () => {
    expect(
      clarificationTriageDecisionSchema.parse({
        decision: "proceed",
        reason: "Multi-step build with unstated scope.",
      }),
    ).toEqual({ decision: "proceed", reason: "Multi-step build with unstated scope." });
  });

  it("rejects an unknown decision literal", () => {
    expect(() =>
      clarificationTriageDecisionSchema.parse({ decision: "maybe", reason: "x" }),
    ).toThrow();
  });

  it("rejects an empty reason", () => {
    expect(() =>
      clarificationTriageDecisionSchema.parse({ decision: "skip", reason: "   " }),
    ).toThrow();
  });
});

describe("PROCEED_TRIAGE_DECISION", () => {
  it("is a frozen proceed decision with a non-empty reason", () => {
    expect(PROCEED_TRIAGE_DECISION.decision).toBe("proceed");
    expect(PROCEED_TRIAGE_DECISION.reason.length).toBeGreaterThan(0);
    expect(Object.isFrozen(PROCEED_TRIAGE_DECISION)).toBe(true);
  });
});

describe("TRIAGE_SKIP_REASON", () => {
  it("matches the ClarificationSkipReason literal", () => {
    expect(TRIAGE_SKIP_REASON).toBe("triage_classifier");
  });
});

describe("createClarificationTriagePrompt", () => {
  it("substitutes the request placeholder when no loader is supplied", () => {
    const prompt = createClarificationTriagePrompt("continue");
    expect(prompt).toContain("continue");
    expect(prompt).toContain("JSON");
  });
});

describe("classifyClarificationTriage", () => {
  it("parses a valid classifier response into a decision", async () => {
    const classifier = fakeClassifier({ decision: "skip", reason: "ok" });
    const decision = await classifyClarificationTriage("ok", classifier);
    expect(decision).toEqual({ decision: "skip", reason: "ok" });
  });

  it("forwards the structured-json system message and the rendered prompt", async () => {
    const classifier = fakeClassifier({ decision: "proceed", reason: "ambiguous" });
    await classifyClarificationTriage("build a kanban board", classifier);
    expect(classifier.calls).toHaveLength(1);
    const messages = classifier.calls[0] as { role: string; content: string }[];
    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toBe(CORE_PROMPT_TEMPLATES.structuredJson.trim());
    expect(messages[1]?.role).toBe("user");
    expect(messages[1]?.content).toContain("build a kanban board");
  });

  it("throws on a malformed classifier response", async () => {
    const classifier = fakeClassifier({ decision: "maybe" });
    await expect(classifyClarificationTriage("hi", classifier)).rejects.toBeDefined();
  });
});

describe("createClarificationTriageClassifier", () => {
  it("returns the explicit classifier when supplied", () => {
    const explicit = fakeClassifier({ decision: "skip", reason: "explicit" });
    expect(createClarificationTriageClassifier({ classifier: explicit })).toBe(explicit);
  });

  it("returns undefined when neither a classifier nor a model is supplied", () => {
    expect(createClarificationTriageClassifier({})).toBeUndefined();
  });

  it("wraps a structured-output model with the jsonMode method", () => {
    let capturedSchema: unknown;
    let capturedOptions: { method?: string } | undefined;
    const fakeStructured = {
      withStructuredOutput(schema: unknown, options?: { method?: string }) {
        capturedSchema = schema;
        capturedOptions = options;
        return fakeClassifier({ decision: "proceed", reason: "wrapped" });
      },
    };
    const classifier = createClarificationTriageClassifier({ model: fakeStructured });
    expect(classifier).toBeDefined();
    expect(capturedOptions?.method).toBe("jsonMode");
    expect(capturedSchema).toBe(clarificationTriageDecisionSchema);
  });
});
