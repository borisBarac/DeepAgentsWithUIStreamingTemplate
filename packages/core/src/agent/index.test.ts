import { describe, expect, it } from "bun:test";
import { createModelRuntime } from "../models/index.ts";
import type { PromptLoader } from "../prompts/index.ts";
import { createBaselineAgent, createBasicAgent } from "./index.ts";

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

function createTestModelRuntime() {
  return createModelRuntime({
    connections: {
      openrouter: { provider: "openrouter", apiKey: "test-key" },
    },
    models: {
      baseline: { connection: "openrouter", model: "baseline-model" },
      supervisor: { connection: "openrouter", model: "supervisor-model" },
      specialist: { connection: "openrouter", model: "specialist-model" },
    },
    assignments: {
      default: "specialist",
      baseline: "baseline",
      supervisor: "supervisor",
    },
  });
}

describe("createBasicAgent", () => {
  it("returns a scaffolded deep agent instance", () => {
    const agent = createBasicAgent({
      openRouter: {
        apiKey: "test-key",
      },
    });

    expect(typeof agent.invoke).toBe("function");
  });

  it("loads the scaffold memory files by default", () => {
    const agent = createBasicAgent({
      openRouter: {
        apiKey: "test-key",
      },
    });

    expect(agent.options.middleware?.map((middleware) => middleware.name)).toContain(
      "MemoryMiddleware",
    );
  });

  it("uses a custom prompt loader for the scaffolded supervisor", () => {
    const agent = createBasicAgent({
      openRouter: {
        apiKey: "test-key",
      },
      promptLoader: testPromptLoader,
    });

    expectSystemPromptToContain(agent.options.systemPrompt, "custom supervisor prompt");
  });

  it("lets an explicit scaffolded system prompt win over the prompt loader", () => {
    const agent = createBasicAgent({
      openRouter: {
        apiKey: "test-key",
      },
      promptLoader: testPromptLoader,
      systemPrompt: "explicit supervisor prompt",
    });

    expectSystemPromptToContain(agent.options.systemPrompt, "explicit supervisor prompt");
  });

  it("uses the supervisor role model", () => {
    const modelRuntime = createTestModelRuntime();
    const agent = createBasicAgent({
      guardrails: false,
      modelRuntime,
    });

    expect((agent.options.model as { model?: string }).model).toBe("supervisor-model");
  });
});

describe("createBaselineAgent", () => {
  it("uses the bundled baseline prompt by default", () => {
    const agent = createBaselineAgent({
      openRouter: {
        apiKey: "test-key",
      },
    });

    expectSystemPromptToContain(agent.options.systemPrompt, "helpful general-purpose deep agent");
  });

  it("uses a custom prompt loader for the baseline prompt", () => {
    const agent = createBaselineAgent({
      openRouter: {
        apiKey: "test-key",
      },
      promptLoader: testPromptLoader,
    });

    expectSystemPromptToContain(agent.options.systemPrompt, "custom baseline prompt");
  });

  it("does not allow untyped callers to override the baseline prompt inline", () => {
    const agent = createBaselineAgent({
      openRouter: {
        apiKey: "test-key",
      },
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

  it("rejects modelRuntime combined with legacy connection options", () => {
    expect(() =>
      createBaselineAgent({
        guardrails: false,
        modelRuntime: createTestModelRuntime(),
        openRouter: { apiKey: "legacy-key" },
      }),
    ).toThrow("cannot be combined");
  });
});
