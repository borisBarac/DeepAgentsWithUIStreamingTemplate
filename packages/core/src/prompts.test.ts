import { describe, expect, it } from "bun:test";

import {
  createClarifierSystemPrompt,
  createSupervisorSystemPrompt,
  DEFAULT_CLARIFIER_SYSTEM_PROMPT,
  DEFAULT_PROMPT_LOADER,
  DEFAULT_SUPERVISOR_SYSTEM_PROMPT,
  MarkdownPromptLoader,
} from "./prompts";

describe("prompt defaults", () => {
  it("exports the default clarifier system prompt", () => {
    expect(DEFAULT_CLARIFIER_SYSTEM_PROMPT).toContain("You are the clarifier subagent.");
    expect(DEFAULT_CLARIFIER_SYSTEM_PROMPT).toContain(
      "Return only the structured readiness payload.",
    );
    expect(DEFAULT_CLARIFIER_SYSTEM_PROMPT).toContain(
      "between 1 and 3 high-value clarification questions per round",
    );
    expect(DEFAULT_CLARIFIER_SYSTEM_PROMPT).toContain("round 10");
  });

  it("makes clarification a required supervisor intake phase", () => {
    expect(DEFAULT_SUPERVISOR_SYSTEM_PROMPT).toContain(
      "Every new top-level user request must go to the clarifier subagent first.",
    );
    expect(DEFAULT_SUPERVISOR_SYSTEM_PROMPT).toContain(
      "Do not begin normal planning, tool use, or specialist delegation until the clarifier returns a structured `ready_to_proceed` result.",
    );
  });

  it("tells the supervisor to relay clarifier questions verbatim", () => {
    expect(DEFAULT_SUPERVISOR_SYSTEM_PROMPT).toContain(
      "Relay each `question` verbatim; do not rephrase, summarize, merge, or invent questions.",
    );
  });

  it("renders prompt builders with custom clarification limits", () => {
    expect(createClarifierSystemPrompt({ maxRounds: 6, questionsPerRound: 2 })).toContain(
      "between 1 and 2 high-value clarification questions per round",
    );
    expect(createClarifierSystemPrompt({ maxRounds: 6, questionsPerRound: 2 })).toContain(
      "round 6",
    );
    expect(createSupervisorSystemPrompt({ maxRounds: 6 })).toContain(
      "If clarification remains unresolved after 6 rounds",
    );
  });

  it("loads default prompts from the markdown prompt loader", () => {
    const loader = new MarkdownPromptLoader();

    expect(loader.getBaselinePrompt()).toContain("helpful general-purpose deep agent");
    expect(loader.getResearcherPrompt()).toContain("You are the researcher subagent.");
    expect(loader.getAnalystPrompt()).toContain("You are the analyst subagent.");
    expect(loader.getCriticPrompt()).toContain("You are the critic subagent.");
  });

  it("uses the default markdown loader for compatibility exports", () => {
    expect(DEFAULT_PROMPT_LOADER.getSupervisorPrompt({ maxRounds: 10 })).toBe(
      DEFAULT_SUPERVISOR_SYSTEM_PROMPT,
    );
    expect(DEFAULT_PROMPT_LOADER.getClarifierPrompt({ maxRounds: 10, questionsPerRound: 3 })).toBe(
      DEFAULT_CLARIFIER_SYSTEM_PROMPT,
    );
  });
});
