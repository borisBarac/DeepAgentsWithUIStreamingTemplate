import { describe, expect, it } from "bun:test";

import {
  AGENT_PROVIDER_MODE_ENV,
  createAgentProvider,
  getAgentProviderMode,
} from "./agent-provider.ts";

function withEnv<T>(value: string | undefined, fn: () => T): T {
  const previous = process.env[AGENT_PROVIDER_MODE_ENV];
  try {
    if (value === undefined) {
      delete process.env[AGENT_PROVIDER_MODE_ENV];
    } else {
      process.env[AGENT_PROVIDER_MODE_ENV] = value;
    }
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env[AGENT_PROVIDER_MODE_ENV];
    } else {
      process.env[AGENT_PROVIDER_MODE_ENV] = previous;
    }
  }
}

describe("agent provider mode", () => {
  it("defaults to simple mode", () => {
    expect(withEnv(undefined, () => getAgentProviderMode())).toBe("simple");
  });

  it("parses advanced mode", () => {
    expect(withEnv("advanced", () => getAgentProviderMode())).toBe("advanced");
  });

  it("rejects unsupported values", () => {
    expect(() => withEnv("broken", () => getAgentProviderMode())).toThrow(
      `${AGENT_PROVIDER_MODE_ENV} must be "simple" or "advanced" when set.`,
    );
  });

  it("returns a note for the advanced branch", () => {
    const provider = withEnv("advanced", () => createAgentProvider());
    expect(provider.mode).toBe("advanced");
    if (provider.mode !== "advanced") {
      throw new Error("Expected advanced provider mode.");
    }
    expect(provider.note).toContain("not implemented yet");
  });
});
