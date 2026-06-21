import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { createBaselineAgent, createScaffoldedAgent } from "../agent/index.ts";
import { createTestModelRuntime } from "../agent/test-helpers.ts";
import { createOrchestratedDeepAgentGraph } from "../orchestration/index.ts";
import { runtimeWithoutRoleAssignments } from "../orchestration/test-helpers.ts";
import { configureLangSmithTracing } from "./index.ts";

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

describe("configureLangSmithTracing", () => {
  it("uses environment-only configuration", () => {
    process.env.LANGSMITH_TRACING = "true";
    process.env.LANGSMITH_PROJECT = "environment-project";
    process.env.LANGSMITH_ENDPOINT = "https://eu.api.smith.langchain.com";
    process.env.LANGSMITH_WORKSPACE_ID = "environment-workspace";

    expect(configureLangSmithTracing()).toEqual({
      enabled: true,
      projectName: "environment-project",
      endpoint: "https://eu.api.smith.langchain.com",
      workspaceId: "environment-workspace",
    });
  });

  it("enables tracing and propagates typed options", () => {
    const config = configureLangSmithTracing({
      apiKey: "test-langsmith-key",
      projectName: "deep-agent-template-test",
      endpoint: "https://eu.api.smith.langchain.com",
      workspaceId: "test-workspace",
    });

    expect(config).toEqual({
      enabled: true,
      projectName: "deep-agent-template-test",
      endpoint: "https://eu.api.smith.langchain.com",
      workspaceId: "test-workspace",
    });
    expect(process.env.LANGSMITH_TRACING).toBe("true");
    expect(process.env.LANGSMITH_API_KEY).toBe("test-langsmith-key");
    expect(process.env.LANGSMITH_WORKSPACE_ID).toBe("test-workspace");
  });

  it("explicitly disables tracing even when stale tracing state and credentials exist", () => {
    process.env.LANGSMITH_TRACING = "true";
    process.env.LANGSMITH_API_KEY = "existing-key";

    expect(configureLangSmithTracing({ enabled: false })).toEqual({
      enabled: false,
      projectName: undefined,
      endpoint: undefined,
      workspaceId: undefined,
    });
    expect(process.env.LANGSMITH_TRACING).toBe("false");
    expect(process.env.LANGSMITH_API_KEY).toBe("existing-key");
  });

  it("respects an environment-level tracing opt-out", () => {
    process.env.LANGSMITH_TRACING = "false";
    process.env.LANGSMITH_API_KEY = "existing-key";

    expect(configureLangSmithTracing().enabled).toBe(false);
    expect(process.env.LANGSMITH_TRACING).toBe("false");
  });

  it("leaves tracing disabled without LangSmith env", () => {
    expect(configureLangSmithTracing()).toEqual({
      enabled: false,
      projectName: undefined,
      endpoint: undefined,
      workspaceId: undefined,
    });
    expect(process.env.LANGSMITH_TRACING).toBe("false");
  });
});

describe("LangSmith factory integration", () => {
  it("applies typed tracing options in the baseline factory", () => {
    createBaselineAgent({
      guardrails: false,
      modelRuntime: createTestModelRuntime(),
      langSmith: { apiKey: "baseline-langsmith-key", projectName: "baseline-project" },
    });

    expect(process.env.LANGSMITH_API_KEY).toBe("baseline-langsmith-key");
    expect(process.env.LANGSMITH_PROJECT).toBe("baseline-project");
    expect(process.env.LANGSMITH_TRACING).toBe("true");
  });

  it("applies typed tracing options in the scaffolded factory", () => {
    createScaffoldedAgent({
      guardrails: false,
      modelRuntime: createTestModelRuntime(),
      langSmith: { apiKey: "scaffold-langsmith-key", projectName: "scaffold-project" },
    });

    expect(process.env.LANGSMITH_API_KEY).toBe("scaffold-langsmith-key");
    expect(process.env.LANGSMITH_PROJECT).toBe("scaffold-project");
    expect(process.env.LANGSMITH_TRACING).toBe("true");
  });

  it("applies typed tracing options before constructing orchestration", () => {
    createOrchestratedDeepAgentGraph({
      modelRuntime: runtimeWithoutRoleAssignments(),
      langSmith: {
        apiKey: "orchestration-langsmith-key",
        projectName: "orchestration-project",
        workspaceId: "orchestration-workspace",
      },
    });

    expect(process.env.LANGSMITH_API_KEY).toBe("orchestration-langsmith-key");
    expect(process.env.LANGSMITH_PROJECT).toBe("orchestration-project");
    expect(process.env.LANGSMITH_WORKSPACE_ID).toBe("orchestration-workspace");
    expect(process.env.LANGSMITH_TRACING).toBe("true");
  });
});
