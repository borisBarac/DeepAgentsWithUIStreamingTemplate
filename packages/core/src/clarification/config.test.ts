import { describe, expect, it } from "bun:test";

import { createClarificationConfig, getDefaultClarificationConfig } from "./config.ts";

describe("clarification defaults", () => {
  it("enables mandatory clarification preflight by default", () => {
    expect(createClarificationConfig()).toEqual({
      enabled: true,
      maxRounds: 10,
      questionsPerRound: 3,
      mode: "mandatory-preflight",
    });
  });

  it("returns the frozen default config object", () => {
    expect(getDefaultClarificationConfig()).toEqual({
      enabled: true,
      maxRounds: 10,
      questionsPerRound: 3,
      mode: "mandatory-preflight",
    });
  });
});
