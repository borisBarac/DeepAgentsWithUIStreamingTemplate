import { afterEach, describe, expect, it } from "bun:test";

import {
  configureLangSmithTracing,
  createBasicAgent,
  createChatModel,
  createDefaultInterrupts,
  createDefaultPermissions,
  createDefaultSubagents,
  createSupervisorBlueprint,
  DEFAULT_DEEPSEEK_MODEL,
  DEFAULT_MODEL_ID,
  resolveModelIdentifier,
} from "./index";

const langSmithEnvKeys = [
  "LANGSMITH_API_KEY",
  "LANGSMITH_ENDPOINT",
  "LANGSMITH_PROJECT",
  "LANGSMITH_TRACING",
] as const;

const originalLangSmithEnv = Object.fromEntries(
  langSmithEnvKeys.map((key) => [key, process.env[key]]),
);

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

describe("resolveModelIdentifier", () => {
  it("uses OpenRouter DeepSeek V4 by default", () => {
    expect(resolveModelIdentifier()).toEqual({
      provider: "openrouter",
      model: DEFAULT_DEEPSEEK_MODEL,
    });
  });

  it("parses provider-prefixed model identifiers", () => {
    expect(resolveModelIdentifier(DEFAULT_MODEL_ID)).toEqual({
      provider: "openrouter",
      model: DEFAULT_DEEPSEEK_MODEL,
    });
  });

  it("rejects unsupported providers", () => {
    expect(() => resolveModelIdentifier("openai:gpt-4o-mini")).toThrow(
      "Unsupported model identifier",
    );
  });
});

describe("createChatModel", () => {
  it("creates an OpenRouter chat model", () => {
    const model = createChatModel({
      openRouter: {
        apiKey: "test-key",
      },
    });

    expect(model.model).toBe(DEFAULT_DEEPSEEK_MODEL);
    expect(model._llmType()).toBe("openrouter");
  });
});

describe("configureLangSmithTracing", () => {
  it("enables tracing when an API key is provided", () => {
    const config = configureLangSmithTracing({
      apiKey: "test-langsmith-key",
      projectName: "deep-agent-template-test",
    });

    expect(config).toEqual({
      enabled: true,
      projectName: "deep-agent-template-test",
      endpoint: undefined,
    });
    expect(process.env.LANGSMITH_TRACING).toBe("true");
    expect(process.env.LANGSMITH_API_KEY).toBe("test-langsmith-key");
  });

  it("leaves tracing disabled without LangSmith env", () => {
    for (const key of langSmithEnvKeys) {
      delete process.env[key];
    }

    expect(configureLangSmithTracing()).toEqual({
      enabled: false,
      projectName: undefined,
      endpoint: undefined,
    });
    expect(process.env.LANGSMITH_TRACING).toBeUndefined();
  });
});

describe("scaffolding defaults", () => {
  it("creates the default interrupt configuration for sensitive tools", () => {
    expect(createDefaultInterrupts()).toEqual({
      write_file: true,
      edit_file: true,
      execute: true,
    });
  });

  it("locks the filesystem down to the scaffold roots by default", () => {
    expect(createDefaultPermissions()).toEqual([
      {
        operations: ["read"],
        paths: ["/"],
      },
      {
        operations: ["read", "write"],
        paths: [
          "/scratch",
          "/scratch/**",
          "/plans",
          "/plans/**",
          "/reports",
          "/reports/**",
          "/artifacts",
          "/artifacts/**",
          "/memory",
          "/memory/**",
        ],
      },
      {
        operations: ["read"],
        paths: [
          "/scratch",
          "/scratch/**",
          "/plans",
          "/plans/**",
          "/reports",
          "/reports/**",
          "/artifacts",
          "/artifacts/**",
          "/memory",
          "/memory/**",
          "/skills",
          "/skills/**",
        ],
      },
      {
        operations: ["read", "write"],
        paths: ["/**"],
        mode: "deny",
      },
    ]);
  });

  it("provides specialist subagents for research, analysis, and critique", () => {
    const subagents = createDefaultSubagents();

    expect(subagents.map((subagent) => subagent.name)).toEqual(["researcher", "analyst", "critic"]);
    expect(subagents.map((subagent) => subagent.tools)).toEqual([[], [], []]);
    expect(subagents.map((subagent) => subagent.skills)).toEqual([[], [], []]);
  });

  it("builds a supervisor blueprint with the recommended architecture", () => {
    const blueprint = createSupervisorBlueprint();

    expect(blueprint.architecture).toBe("supervisor-specialists");
    expect(blueprint.memoryFilePaths).toEqual(["/memory/AGENTS.md", "/memory/user-preferences.md"]);
    expect(blueprint.virtualFilesystem.reports).toBe("/reports");
  });
});

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
});
