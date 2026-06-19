import { describe, expect, it } from "bun:test";

import { createBasicAgent } from "../agent/index.ts";
import { createModelRuntime } from "../models/index.ts";
import {
  createGuardrailDecision,
  DEFAULT_SAFETY_GUARDRAIL_NAME,
  DEFAULT_TASK_SCOPE_GUARDRAIL_NAME,
} from "./index.ts";
import type { OpenAIContentSafetyClient, TaskScopeClassifier } from "./types.ts";

function createTestModelRuntime() {
  return createModelRuntime({
    connections: {
      default: { apiKey: "test-key", baseURL: "https://api.openai.com/v1" },
    },
    models: {
      primary: { connection: "default", model: "primary-model" },
    },
    assignments: { default: "primary" },
  });
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

describe("createGuardrailDecision", () => {
  it("creates safety and task-scope middleware before caller middleware", () => {
    const classifier: TaskScopeClassifier = {
      invoke: async () => ({
        inScope: true,
        missingContext: [],
        violatedRules: [],
        reason: "ok",
      }),
    };
    const callerMiddleware = { name: "CallerMiddleware" };

    const decision = createGuardrailDecision({
      safety: {
        openai: createFakeOpenAI(false),
      },
      taskScope: { classifier },
      middleware: [callerMiddleware],
    });

    expect(decision.middleware.map((item) => item.name)).toEqual([
      DEFAULT_SAFETY_GUARDRAIL_NAME,
      DEFAULT_TASK_SCOPE_GUARDRAIL_NAME,
      "CallerMiddleware",
    ]);
  });

  it("can disable guardrails while preserving caller middleware", () => {
    const callerMiddleware = { name: "CallerMiddleware" };
    const decision = createGuardrailDecision({
      enabled: false,
      middleware: [callerMiddleware],
    });

    expect(decision.enabled).toEqual({ safety: false, taskScope: false });
    expect(decision.middleware).toEqual([callerMiddleware]);
  });

  it("can be created without a task-scope model", () => {
    const decision = createGuardrailDecision({
      safety: {
        openai: createFakeOpenAI(false),
      },
    });

    expect(decision.enabled).toEqual({ safety: true, taskScope: false });
    expect(decision.middleware.map((item) => item.name)).toEqual([DEFAULT_SAFETY_GUARDRAIL_NAME]);
  });

  it("returns resolved task-scope policies", () => {
    const decision = createGuardrailDecision({
      enabled: false,
      taskScope: {
        policies: {
          allowedTasks: "Only repository tasks.",
        },
      },
    });

    expect(decision.policies.allowedTasks).toBe("Only repository tasks.");
    expect(decision.policies.requiredContext).toContain("Required Context");
    expect(decision.policies.disallowedTasks).toContain("Disallowed Tasks");
  });
});

describe("agent guardrail integration", () => {
  it("adds default guardrails to scaffolded agents before caller middleware", () => {
    const callerMiddleware = { name: "CallerMiddleware" };
    const agent = createBasicAgent({
      guardrails: {
        safety: { openai: createFakeOpenAI(false) },
      },
      modelRuntime: createTestModelRuntime(),
      middleware: [callerMiddleware],
    });
    const names = agent.options.middleware?.map((middleware) => middleware.name);

    expect(names).toContain(DEFAULT_SAFETY_GUARDRAIL_NAME);
    expect(names).toContain(DEFAULT_TASK_SCOPE_GUARDRAIL_NAME);
    expect(names?.indexOf(DEFAULT_SAFETY_GUARDRAIL_NAME)).toBeLessThan(
      names?.indexOf(DEFAULT_TASK_SCOPE_GUARDRAIL_NAME) ?? Number.POSITIVE_INFINITY,
    );
    expect(names?.indexOf(DEFAULT_TASK_SCOPE_GUARDRAIL_NAME)).toBeLessThan(
      names?.indexOf("CallerMiddleware") ?? Number.POSITIVE_INFINITY,
    );
  });

  it("lets callers disable default guardrails", () => {
    const agent = createBasicAgent({
      guardrails: false,
      modelRuntime: createTestModelRuntime(),
    });
    const names = agent.options.middleware?.map((middleware) => middleware.name) ?? [];

    expect(names).not.toContain(DEFAULT_SAFETY_GUARDRAIL_NAME);
    expect(names).not.toContain(DEFAULT_TASK_SCOPE_GUARDRAIL_NAME);
  });
});
