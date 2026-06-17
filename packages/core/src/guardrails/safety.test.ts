import { describe, expect, it } from "bun:test";

import { createSafetyGuardrail } from "./safety.ts";
import type { OpenAIContentSafetyClient } from "./types.ts";

type HookableMiddleware = {
  beforeAgent: {
    hook(state: { messages: Array<{ role: string; content: string }> }): Promise<unknown>;
  };
};

function asHookable(middleware: unknown): HookableMiddleware {
  return middleware as HookableMiddleware;
}

function createFakeOpenAI(flagged: boolean): OpenAIContentSafetyClient {
  return {
    moderations: {
      create: async () => ({
        id: "modr-test",
        model: "omni-moderation-latest",
        results: [
          {
            flagged,
            categories: {},
            category_scores: {},
          },
        ],
      }),
    },
  } as unknown as OpenAIContentSafetyClient;
}

describe("safety guardrail", () => {
  it("blocks flagged moderation results before the agent runs", async () => {
    const middleware = asHookable(
      createSafetyGuardrail({
        openai: createFakeOpenAI(true),
      }),
    );

    const result = await middleware.beforeAgent.hook({
      messages: [{ role: "user", content: "unsafe request" }],
    });

    expect(JSON.stringify(result)).toContain("unsafe content");
  });

  it("allows unflagged moderation results", async () => {
    const middleware = asHookable(
      createSafetyGuardrail({
        openai: createFakeOpenAI(false),
      }),
    );

    const result = await middleware.beforeAgent.hook({
      messages: [{ role: "user", content: "summarize this file" }],
    });

    expect(result).toBeUndefined();
  });
});
