import { describe, expect, it } from "bun:test";

import { createTaskScopeGuardrail } from "./task-scope.ts";
import type { TaskScopeClassifier } from "./types.ts";

type HookableMiddleware = {
  beforeAgent: {
    hook(state: { messages: Array<{ role: string; content: string }> }): Promise<unknown>;
  };
};

function asHookable(middleware: unknown): HookableMiddleware {
  return middleware as HookableMiddleware;
}

describe("task-scope guardrail", () => {
  it("blocks out-of-scope requests using the structured classifier", async () => {
    const classifier: TaskScopeClassifier = {
      invoke: async () => ({
        inScope: false,
        missingContext: [],
        violatedRules: ["outside project"],
        reason: "The request is unrelated to this project.",
      }),
    };
    const middleware = asHookable(
      createTaskScopeGuardrail({
        classifier,
      }),
    );

    const result = await middleware.beforeAgent.hook({
      messages: [{ role: "user", content: "book me a flight" }],
    });

    expect(JSON.stringify(result)).toContain("I cannot help with that request");
  });

  it("allows in-scope requests", async () => {
    const classifier: TaskScopeClassifier = {
      invoke: async () => ({
        inScope: true,
        missingContext: [],
        violatedRules: [],
        reason: "The request targets this repository.",
      }),
    };
    const middleware = asHookable(
      createTaskScopeGuardrail({
        classifier,
      }),
    );

    const result = await middleware.beforeAgent.hook({
      messages: [{ role: "user", content: "add guardrail tests" }],
    });

    expect(result).toBeUndefined();
  });
});
