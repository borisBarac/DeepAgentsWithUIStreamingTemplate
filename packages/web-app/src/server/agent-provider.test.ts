import { describe, expect, it } from "bun:test";

import { createAgentProvider } from "./agent-provider.ts";

const BASE_ENV: Record<string, string> = {
  LLM_BASE_URL: "https://example.com/v1",
  LLM_API_KEY: "test-key",
  USE_FAKE_IMAGE_PROVIDER: "true",
};

function withEnv<T>(overrides: Record<string, string | undefined>, fn: () => T): T {
  const previous: Record<string, string | undefined> = {};
  const allKeys = new Set([...Object.keys(BASE_ENV), ...Object.keys(overrides)]);
  for (const key of allKeys) {
    previous[key] = process.env[key];
  }
  try {
    for (const [key, value] of Object.entries(BASE_ENV)) {
      process.env[key] = value;
    }
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

describe("createAgentProvider", () => {
  it("returns the advanced scaffolded agent by default", () => {
    const agent = withEnv({}, () => createAgentProvider());
    expect(agent).toBeTruthy();
    expect(typeof agent.invoke).toBe("function");
  });

  it("ignores WEB_APP_AGENT_PROVIDER_MODE and always returns the advanced agent", () => {
    const agent = withEnv({ WEB_APP_AGENT_PROVIDER_MODE: "simple" }, () => createAgentProvider());
    expect(agent).toBeTruthy();
    expect(typeof agent.invoke).toBe("function");
  });
});
