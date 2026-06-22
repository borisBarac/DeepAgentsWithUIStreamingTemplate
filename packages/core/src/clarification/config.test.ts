import { describe, expect, it } from "bun:test";

import { createClarificationConfig } from "./config.ts";

describe("clarification defaults", () => {
  it("enables mandatory clarification preflight by default", () => {
    expect(createClarificationConfig()).toEqual({
      enabled: true,
      maxRounds: 2,
      questionsPerRound: 3,
      mode: "mandatory-preflight",
    });
  });
});
