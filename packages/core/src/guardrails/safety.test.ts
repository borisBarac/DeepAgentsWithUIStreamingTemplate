import { describe, expect, it } from "bun:test";

import { createSafetyGuardrail } from "./safety.ts";
import type { SafetyClassifier, StructuredSafetyModel } from "./types.ts";

type HookableMiddleware = {
  beforeAgent: {
    hook(state: { messages: Array<{ role: string; content: string }> }): Promise<unknown>;
  };
};

function asHookable(middleware: unknown): HookableMiddleware {
  return middleware as HookableMiddleware;
}

function createFakeClassifier(flagged: boolean): SafetyClassifier {
  return {
    invoke: async () => ({
      flagged,
      categories: flagged ? ["violence"] : [],
      reason: flagged ? "unsafe content" : "safe",
    }),
  };
}

describe("safety guardrail", () => {
  it("blocks flagged requests before the agent runs", async () => {
    const middleware = asHookable(
      createSafetyGuardrail({
        classifier: createFakeClassifier(true),
      }),
    );

    const result = await middleware.beforeAgent.hook({
      messages: [{ role: "user", content: "unsafe request" }],
    });

    expect(JSON.stringify(result)).toContain("unsafe content");
  });

  it("allows unflagged requests", async () => {
    const middleware = asHookable(
      createSafetyGuardrail({
        classifier: createFakeClassifier(false),
      }),
    );

    const result = await middleware.beforeAgent.hook({
      messages: [{ role: "user", content: "summarize this file" }],
    });

    expect(result).toBeUndefined();
  });

  it("throws when neither a classifier nor a model is provided", () => {
    expect(() => createSafetyGuardrail()).toThrow(
      "Safety guardrail requires a classifier or structured-output model.",
    );
  });

  it("uses an explicit classifier before any structured-output model", async () => {
    const model: StructuredSafetyModel = {
      withStructuredOutput: () => {
        throw new Error("model should not be used");
      },
    };
    const middleware = asHookable(
      createSafetyGuardrail({
        classifier: createFakeClassifier(false),
        model,
      }),
    );

    const result = await middleware.beforeAgent.hook({
      messages: [{ role: "user", content: "summarize this file" }],
    });

    expect(result).toBeUndefined();
  });
});
