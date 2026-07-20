import { afterEach, describe, expect, it } from "bun:test";

import {
  AGENT_HARNESS_PROFILE_KEY,
  clearHarnessProfileRegistry,
  createAgentHarnessProfile,
  DEFAULT_AGENT_PROFILE,
  ensureDefaultAgentProfileRegistered,
  HARNESS_PROFILE_REGISTRY_SYMBOL,
  registerAgentProfile,
} from "./index.ts";

afterEach(() => {
  clearHarnessProfileRegistry();
});

describe("DEFAULT_AGENT_PROFILE", () => {
  it("carries a non-empty prose-contract systemPromptSuffix", () => {
    expect(DEFAULT_AGENT_PROFILE.systemPromptSuffix).toMatch(/prose/i);
  });

  it("disables deepagents' auto-added general-purpose subagent", () => {
    expect(DEFAULT_AGENT_PROFILE.generalPurposeSubagent?.enabled).toBe(false);
  });

  it("wires a repo-style GP system prompt", () => {
    expect(DEFAULT_AGENT_PROFILE.generalPurposeSubagent?.systemPrompt).toMatch(
      /general-purpose subagent/,
    );
  });
});

describe("createAgentHarnessProfile", () => {
  it("returns the default profile unchanged when no overrides are given", () => {
    const profile = createAgentHarnessProfile();
    expect(profile.systemPromptSuffix).toBe(DEFAULT_AGENT_PROFILE.systemPromptSuffix);
  });

  it("overrides systemPromptSuffix scalar", () => {
    const profile = createAgentHarnessProfile({ systemPromptSuffix: "CALLER_MARKER" });
    expect(profile.systemPromptSuffix).toBe("CALLER_MARKER");
  });

  it("shallow-merges generalPurposeSubagent so callers can override one field", () => {
    const profile = createAgentHarnessProfile({
      generalPurposeSubagent: { description: "Caller-described GP" },
    });
    expect(profile.generalPurposeSubagent?.description).toBe("Caller-described GP");
    // systemPrompt inherited from the default.
    expect(profile.generalPurposeSubagent?.systemPrompt).toBe(
      DEFAULT_AGENT_PROFILE.generalPurposeSubagent?.systemPrompt,
    );
  });

  it("freezes the returned profile", () => {
    const profile = createAgentHarnessProfile();
    expect(Object.isFrozen(profile)).toBe(true);
  });
});

describe("ensureDefaultAgentProfileRegistered", () => {
  it("registers under the bare 'openai' key", () => {
    ensureDefaultAgentProfileRegistered();
    const registry = (
      globalThis as Record<symbol, { profiles: Map<string, unknown> | undefined } | undefined>
    )[HARNESS_PROFILE_REGISTRY_SYMBOL];
    expect(registry?.profiles?.has(AGENT_HARNESS_PROFILE_KEY)).toBe(true);
  });

  it("is idempotent at the module level", () => {
    ensureDefaultAgentProfileRegistered();
    const before = (globalThis as Record<symbol, { profiles: Map<string, unknown> } | undefined>)[
      HARNESS_PROFILE_REGISTRY_SYMBOL
    ]?.profiles?.get(AGENT_HARNESS_PROFILE_KEY);
    ensureDefaultAgentProfileRegistered();
    const after = (globalThis as Record<symbol, { profiles: Map<string, unknown> } | undefined>)[
      HARNESS_PROFILE_REGISTRY_SYMBOL
    ]?.profiles?.get(AGENT_HARNESS_PROFILE_KEY);
    expect(after).toBe(before);
  });
});

describe("registerAgentProfile", () => {
  it("returns the resolved profile deepagents will see", () => {
    const resolved = registerAgentProfile({ systemPromptSuffix: "CUSTOM_MARKER" });
    expect(resolved.systemPromptSuffix).toMatch(/CUSTOM_MARKER/);
  });

  it("merges caller overrides on top of any existing registration", () => {
    ensureDefaultAgentProfileRegistered();
    const before = registerAgentProfile({ systemPromptSuffix: "LATER_MARKER" });
    expect(before.systemPromptSuffix).toMatch(/LATER_MARKER/);
  });
});
