import { describe, expect, it } from "bun:test";

import { createTaskScopeGatekeeper } from "./gatekeeper.ts";
import type { TaskScopeClassifier } from "./types.ts";

function classifierFor(inScope: boolean): TaskScopeClassifier {
  return {
    invoke: async () => ({
      inScope,
      missingContext: [],
      violatedRules: inScope ? [] : ["outside project scope"],
      reason: inScope ? "The task targets this project." : "The task does not target this project.",
    }),
  };
}

describe("task-scope gatekeeper", () => {
  it("allows an in-scope task without producing a blocked response", async () => {
    const gatekeeper = createTaskScopeGatekeeper({
      classifier: classifierFor(true),
    });

    const result = await gatekeeper.check("Add tests to the core package");

    expect(result.decision.inScope).toBe(true);
    expect(result.blockedMessage).toBeUndefined();
  });

  it("blocks an out-of-scope task with a user-facing explanation", async () => {
    const gatekeeper = createTaskScopeGatekeeper({
      classifier: classifierFor(false),
    });

    const result = await gatekeeper.check("Book a flight");

    expect(result.decision.inScope).toBe(false);
    expect(result.blockedMessage).toContain("outside the system parameters");
    expect(result.blockedMessage).toContain("does not target this project");
  });
});
