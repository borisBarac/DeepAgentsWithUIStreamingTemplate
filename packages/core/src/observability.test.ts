import { afterEach, describe, expect, it } from "bun:test";

import { configureLangSmithTracing } from "./observability";

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
