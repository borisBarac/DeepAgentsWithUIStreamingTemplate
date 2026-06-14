import { afterEach, describe, expect, it } from "bun:test";

import {
  configureLangSmithTracing,
  createChatModel,
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
