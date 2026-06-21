import { describe, expect, it } from "bun:test";

import type { PromptLoader } from "../prompts/index.ts";
import { createBaselineAgent, createScaffoldedAgent } from "./index.ts";
import { createTestModelRuntime } from "./test-helpers.ts";

const testPromptLoader: PromptLoader = {
  getBaselinePrompt: () => "custom baseline prompt",
  getSupervisorPrompt: () => "custom supervisor prompt",
  getClarifierPrompt: () => "custom clarifier prompt",
  getResearcherPrompt: () => "custom researcher prompt",
  getAnalystPrompt: () => "custom analyst prompt",
  getReviewAgentPrompt: () => "custom review prompt",
};

function expectSystemPromptToContain(systemPrompt: unknown, text: string): void {
  expect(JSON.stringify(systemPrompt)).toContain(text);
}

describe("createScaffoldedAgent", () => {
  it("returns a scaffolded deep agent instance", () => {
    const agent = createScaffoldedAgent({
      modelRuntime: createTestModelRuntime(),
    });

    expect(typeof agent.invoke).toBe("function");
  });

  it("loads the scaffold memory files by default", () => {
    const agent = createScaffoldedAgent({
      modelRuntime: createTestModelRuntime(),
    });

    expect(agent.options.middleware?.map((middleware) => middleware.name)).toContain(
      "MemoryMiddleware",
    );
  });

  it("uses a custom prompt loader for the scaffolded supervisor", () => {
    const agent = createScaffoldedAgent({
      modelRuntime: createTestModelRuntime(),
      promptLoader: testPromptLoader,
    });

    expectSystemPromptToContain(agent.options.systemPrompt, "custom supervisor prompt");
  });

  it("lets an explicit scaffolded system prompt win over the prompt loader", () => {
    const agent = createScaffoldedAgent({
      modelRuntime: createTestModelRuntime(),
      promptLoader: testPromptLoader,
      systemPrompt: "explicit supervisor prompt",
    });

    expectSystemPromptToContain(agent.options.systemPrompt, "explicit supervisor prompt");
  });

  it("uses the supervisor role model", () => {
    const modelRuntime = createTestModelRuntime();
    const agent = createScaffoldedAgent({
      guardrails: false,
      modelRuntime,
    });

    expect((agent.options.model as { model?: string }).model).toBe("supervisor-model");
  });
});

describe("createBaselineAgent", () => {
  it("uses the bundled baseline prompt by default", () => {
    const agent = createBaselineAgent({
      modelRuntime: createTestModelRuntime(),
    });

    expectSystemPromptToContain(agent.options.systemPrompt, "helpful general-purpose deep agent");
  });

  it("uses a custom prompt loader for the baseline prompt", () => {
    const agent = createBaselineAgent({
      modelRuntime: createTestModelRuntime(),
      promptLoader: testPromptLoader,
    });

    expectSystemPromptToContain(agent.options.systemPrompt, "custom baseline prompt");
  });

  it("does not allow untyped callers to override the baseline prompt inline", () => {
    const agent = createBaselineAgent({
      modelRuntime: createTestModelRuntime(),
      promptLoader: testPromptLoader,
      systemPrompt: "inline override",
    } as Parameters<typeof createBaselineAgent>[0]);

    expectSystemPromptToContain(agent.options.systemPrompt, "custom baseline prompt");
    expect(JSON.stringify(agent.options.systemPrompt)).not.toContain("inline override");
  });

  it("uses the baseline role assignment", () => {
    const agent = createBaselineAgent({
      guardrails: false,
      modelRuntime: createTestModelRuntime(),
    });

    expect((agent.options.model as { model?: string }).model).toBe("baseline-model");
  });
});
