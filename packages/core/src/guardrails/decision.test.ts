import { describe, expect, it } from "bun:test";

import { createScaffoldedAgent } from "../agent/index.ts";
import { createTestModelRuntime } from "../agent/test-helpers.ts";
import { createGuardrailDecision } from "./index.ts";
import { DEFAULT_SAFETY_GUARDRAIL_NAME } from "./safety.ts";
import { DEFAULT_TASK_SCOPE_GUARDRAIL_NAME } from "./task-scope.ts";
import type {
  SafetyClassifier,
  StructuredSafetyModel,
  StructuredTaskScopeModel,
  TaskScopeClassifier,
} from "./types.ts";

const testImageGenerationService = {
  async generate() {
    return { success: true as const, url: "https://example.com/generated.png" };
  },
  async edit() {
    return { success: true as const, url: "https://example.com/edited.png" };
  },
};

function createFakeSafetyClassifier(): SafetyClassifier {
  return {
    invoke: async () => ({
      flagged: false,
      categories: [],
      reason: "safe",
    }),
  };
}

function createFakeStructuredModel(
  label: string,
  calls: string[],
): StructuredSafetyModel & StructuredTaskScopeModel {
  return {
    withStructuredOutput: () => {
      calls.push(label);
      return {
        invoke: async () => ({
          flagged: false,
          categories: [],
          inScope: true,
          missingContext: [],
          violatedRules: [],
          reason: "ok",
        }),
      };
    },
  };
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
        classifier: createFakeSafetyClassifier(),
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
        classifier: createFakeSafetyClassifier(),
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

  it("uses taskScopeModel as the custom-runtime default for both guardrails", () => {
    const calls: string[] = [];
    const taskScopeModel = createFakeStructuredModel("taskScopeModel", calls);

    const decision = createGuardrailDecision({
      taskScopeModel,
    });

    expect(decision.enabled).toEqual({ safety: true, taskScope: true });
    expect(decision.middleware.map((item) => item.name)).toEqual([
      DEFAULT_SAFETY_GUARDRAIL_NAME,
      DEFAULT_TASK_SCOPE_GUARDRAIL_NAME,
    ]);
    expect(calls).toEqual(["taskScopeModel", "taskScopeModel"]);
  });

  it("resolves safety models from rail override, top-level safety default, then task-scope default", () => {
    const nestedSafetyCalls: string[] = [];
    createGuardrailDecision({
      safety: { model: createFakeStructuredModel("safety.model", nestedSafetyCalls) },
      safetyModel: createFakeStructuredModel("safetyModel", nestedSafetyCalls),
      taskScopeModel: createFakeStructuredModel("taskScopeModel", nestedSafetyCalls),
    });
    expect(nestedSafetyCalls).toEqual(["safety.model", "taskScopeModel"]);

    const safetyDefaultCalls: string[] = [];
    createGuardrailDecision({
      safetyModel: createFakeStructuredModel("safetyModel", safetyDefaultCalls),
      taskScopeModel: createFakeStructuredModel("taskScopeModel", safetyDefaultCalls),
    });
    expect(safetyDefaultCalls).toEqual(["safetyModel", "taskScopeModel"]);

    const taskScopeDefaultCalls: string[] = [];
    createGuardrailDecision({
      taskScopeModel: createFakeStructuredModel("taskScopeModel", taskScopeDefaultCalls),
    });
    expect(taskScopeDefaultCalls).toEqual(["taskScopeModel", "taskScopeModel"]);
  });

  it("disables individual guardrails even when models are provided", () => {
    const safetyDisabledCalls: string[] = [];
    const safetyDisabled = createGuardrailDecision({
      safety: false,
      safetyModel: createFakeStructuredModel("safetyModel", safetyDisabledCalls),
      taskScopeModel: createFakeStructuredModel("taskScopeModel", safetyDisabledCalls),
    });
    expect(safetyDisabled.enabled).toEqual({ safety: false, taskScope: true });
    expect(safetyDisabled.middleware.map((item) => item.name)).toEqual([
      DEFAULT_TASK_SCOPE_GUARDRAIL_NAME,
    ]);
    expect(safetyDisabledCalls).toEqual(["taskScopeModel"]);

    const taskScopeDisabledCalls: string[] = [];
    const taskScopeDisabled = createGuardrailDecision({
      safetyModel: createFakeStructuredModel("safetyModel", taskScopeDisabledCalls),
      taskScope: false,
      taskScopeModel: createFakeStructuredModel("taskScopeModel", taskScopeDisabledCalls),
    });
    expect(taskScopeDisabled.enabled).toEqual({ safety: true, taskScope: false });
    expect(taskScopeDisabled.middleware.map((item) => item.name)).toEqual([
      DEFAULT_SAFETY_GUARDRAIL_NAME,
    ]);
    expect(taskScopeDisabledCalls).toEqual(["safetyModel"]);
  });
});

describe("agent guardrail integration", () => {
  it("adds default guardrails to scaffolded agents before caller middleware", () => {
    const callerMiddleware = { name: "CallerMiddleware" };
    const agent = createScaffoldedAgent({
      guardrails: {
        safety: { classifier: createFakeSafetyClassifier() },
      },
      imageGenerationService: testImageGenerationService,
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
    const agent = createScaffoldedAgent({
      guardrails: false,
      imageGenerationService: testImageGenerationService,
      modelRuntime: createTestModelRuntime(),
    });
    const names = agent.options.middleware?.map((middleware) => middleware.name) ?? [];

    expect(names).not.toContain(DEFAULT_SAFETY_GUARDRAIL_NAME);
    expect(names).not.toContain(DEFAULT_TASK_SCOPE_GUARDRAIL_NAME);
  });
});
