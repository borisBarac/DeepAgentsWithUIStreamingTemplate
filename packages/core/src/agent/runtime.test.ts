import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { DEFAULT_SAFETY_GUARDRAIL_NAME } from "../guardrails/safety.ts";
import { DEFAULT_TASK_SCOPE_GUARDRAIL_NAME } from "../guardrails/task-scope.ts";
import { createRuntimeScaffold } from "../scaffold/index.ts";
import { createAgentFromRuntimeScaffold } from "./runtime.ts";
import { createTestModelRuntime } from "./test-helpers.ts";

const langSmithEnvKeys = [
  "LANGSMITH_API_KEY",
  "LANGSMITH_ENDPOINT",
  "LANGSMITH_PROJECT",
  "LANGSMITH_TRACING",
  "LANGSMITH_WORKSPACE_ID",
] as const;

const originalLangSmithEnv = Object.fromEntries(
  langSmithEnvKeys.map((key) => [key, process.env[key]]),
);

beforeEach(() => {
  for (const key of langSmithEnvKeys) {
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of langSmithEnvKeys) {
    const originalValue = originalLangSmithEnv[key];

    if (originalValue === undefined) {
      delete process.env[key];
      continue;
    }

    process.env[key] = originalValue;
  }
});

describe("createAgentFromRuntimeScaffold", () => {
  it("applies LangSmith options", () => {
    createAgentFromRuntimeScaffold({
      factoryName: "createBaselineAgent",
      scaffold: createRuntimeScaffold({ mode: "baseline" }),
      modelRuntime: createTestModelRuntime(),
      guardrails: false,
      langSmith: { apiKey: "runtime-langsmith-key", projectName: "runtime-project" },
    });

    expect(process.env.LANGSMITH_API_KEY).toBe("runtime-langsmith-key");
    expect(process.env.LANGSMITH_PROJECT).toBe("runtime-project");
    expect(process.env.LANGSMITH_TRACING).toBe("true");
  });

  it("orders guardrail middleware before caller middleware", () => {
    const callerMiddleware = { name: "CallerMiddleware" };
    const agent = createAgentFromRuntimeScaffold({
      factoryName: "createScaffoldedAgent",
      scaffold: createRuntimeScaffold(),
      modelRuntime: createTestModelRuntime(),
      middleware: [callerMiddleware],
    });
    const names = agent.options.middleware?.map((middleware) => middleware.name) ?? [];

    expect(names).toContain(DEFAULT_SAFETY_GUARDRAIL_NAME);
    expect(names).toContain(DEFAULT_TASK_SCOPE_GUARDRAIL_NAME);
    expect(names).toContain("CallerMiddleware");
    expect(names.indexOf(DEFAULT_SAFETY_GUARDRAIL_NAME)).toBeLessThan(
      names.indexOf(DEFAULT_TASK_SCOPE_GUARDRAIL_NAME),
    );
    expect(names.indexOf(DEFAULT_TASK_SCOPE_GUARDRAIL_NAME)).toBeLessThan(
      names.indexOf("CallerMiddleware"),
    );
  });

  it("disables guardrail middleware while preserving caller middleware", () => {
    const callerMiddleware = { name: "CallerMiddleware" };
    const agent = createAgentFromRuntimeScaffold({
      factoryName: "createBaselineAgent",
      scaffold: createRuntimeScaffold({ mode: "baseline" }),
      modelRuntime: createTestModelRuntime(),
      guardrails: false,
      middleware: [callerMiddleware],
    });
    const names = agent.options.middleware?.map((middleware) => middleware.name) ?? [];

    expect(names).not.toContain(DEFAULT_SAFETY_GUARDRAIL_NAME);
    expect(names).not.toContain(DEFAULT_TASK_SCOPE_GUARDRAIL_NAME);
    expect(names).toContain("CallerMiddleware");
  });

  it("selects the model role from the scaffold mode", () => {
    const modelRuntime = createTestModelRuntime();
    const baseline = createAgentFromRuntimeScaffold({
      factoryName: "createBaselineAgent",
      scaffold: createRuntimeScaffold({ mode: "baseline" }),
      modelRuntime,
      guardrails: false,
    });
    const supervisor = createAgentFromRuntimeScaffold({
      factoryName: "createScaffoldedAgent",
      scaffold: createRuntimeScaffold(),
      modelRuntime,
      guardrails: false,
    });

    expect((baseline.options.model as { model?: string }).model).toBe("normal-model");
    expect((supervisor.options.model as { model?: string }).model).toBe("pro-model");
  });
});
