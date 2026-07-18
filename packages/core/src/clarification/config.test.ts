import { describe, expect, it } from "bun:test";

import { createClarificationConfig } from "./config.ts";

describe("clarification defaults", () => {
  it("enables mandatory clarification preflight by default", () => {
    expect(createClarificationConfig()).toEqual({
      enabled: true,
      maxRounds: 2,
      questionsPerRound: 3,
      mode: "mandatory-preflight",
      triage: { enabled: true },
    });
  });

  it("enables triage by default and lets callers disable it", () => {
    expect(createClarificationConfig().triage).toEqual({ enabled: true });
    expect(createClarificationConfig({ triage: { enabled: false } }).triage).toEqual({
      enabled: false,
    });
  });

  it("keeps triage enabled when only unrelated overrides are supplied", () => {
    const config = createClarificationConfig({ maxRounds: 5 });
    expect(config.triage).toEqual({ enabled: true });
    expect(config.maxRounds).toBe(5);
  });
});
