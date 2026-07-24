import { describe, expect, it } from "bun:test";

import { createCasualScopeGuardrail, DEFAULT_CASUAL_REFUSAL } from "./casual-scope.ts";
import type { TaskScopeClassifier } from "./types.ts";

type HookableMiddleware = {
  beforeAgent: {
    hook(state: { messages: Array<{ role: string; content: string }> }): Promise<unknown>;
  };
};

function asHookable(middleware: unknown): HookableMiddleware {
  return middleware as HookableMiddleware;
}

describe("casual scope guardrail", () => {
  it("blocks task/complex requests with the default refusal", async () => {
    const classifier: TaskScopeClassifier = {
      invoke: async () => ({ allow: false, reason: "Asks for long-form writing." }),
    };
    const middleware = asHookable(createCasualScopeGuardrail({ classifier }));

    const result = (await middleware.beforeAgent.hook({
      messages: [{ role: "user", content: "Write me a 5-paragraph essay about Rome" }],
    })) as { messages: Array<{ content: string }>; jumpTo: string };

    expect(result.jumpTo).toBe("end");
    expect(result.messages[0]?.content).toContain(DEFAULT_CASUAL_REFUSAL);
  });

  it("uses a custom refusal message when provided", async () => {
    const classifier: TaskScopeClassifier = {
      invoke: async () => ({ allow: false, reason: "Code task." }),
    };
    const middleware = asHookable(
      createCasualScopeGuardrail({ classifier, refusalMessage: "Nope, not here." }),
    );

    const result = (await middleware.beforeAgent.hook({
      messages: [{ role: "user", content: "debug this python script" }],
    })) as { messages: Array<{ content: string }>; jumpTo: string };

    expect(result.jumpTo).toBe("end");
    expect(result.messages[0]?.content).toBe("Nope, not here.");
  });

  it("allows simple greetings and proceeds to the casual agent", async () => {
    const classifier: TaskScopeClassifier = {
      invoke: async () => ({ allow: true, reason: "Greeting." }),
    };
    const middleware = asHookable(createCasualScopeGuardrail({ classifier }));

    const result = await middleware.beforeAgent.hook({
      messages: [{ role: "user", content: "Hi, how are you?" }],
    });

    expect(result).toBeUndefined();
  });

  it("skips classification when there is no user message", async () => {
    let invoked = false;
    const classifier: TaskScopeClassifier = {
      invoke: async () => {
        invoked = true;
        return { allow: true, reason: "" };
      },
    };
    const middleware = asHookable(createCasualScopeGuardrail({ classifier }));

    const result = await middleware.beforeAgent.hook({ messages: [] });

    expect(result).toBeUndefined();
    expect(invoked).toBe(false);
  });
});
