import { describe, expect, it } from "bun:test";

import {
  createClarifierSystemPrompt,
  createSupervisorSystemPrompt,
  DEFAULT_CLARIFIER_SYSTEM_PROMPT,
  DEFAULT_IMAGE_DESIGNER_SYSTEM_PROMPT,
  DEFAULT_PROMPT_LOADER,
  DEFAULT_REVIEW_AGENT_SYSTEM_PROMPT,
  DEFAULT_SUPERVISOR_SYSTEM_PROMPT,
  MarkdownPromptLoader,
} from "./index.ts";

describe("prompt defaults", () => {
  it("exports the default clarifier system prompt", () => {
    expect(DEFAULT_CLARIFIER_SYSTEM_PROMPT).toContain("You are the clarifier subagent.");
    expect(DEFAULT_CLARIFIER_SYSTEM_PROMPT).toContain(
      "Return only the structured readiness payload.",
    );
    expect(DEFAULT_CLARIFIER_SYSTEM_PROMPT).toContain(
      "between 1 and 3 high-value clarification questions per round",
    );
    expect(DEFAULT_CLARIFIER_SYSTEM_PROMPT).toContain("round 2");
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
    expect(DEFAULT_SUPERVISOR_SYSTEM_PROMPT).toContain(
      "present every option's `label` and `description`",
    );
    expect(DEFAULT_SUPERVISOR_SYSTEM_PROMPT).toContain(
      "When a question omits `options`, ask it directly",
    );
  });

  it("tells the clarifier to offer bounded options with a direct-question fallback", () => {
    expect(DEFAULT_CLARIFIER_SYSTEM_PROMPT).toContain(
      "When a question has 2-4 clear, mutually exclusive answers",
    );
    expect(DEFAULT_CLARIFIER_SYSTEM_PROMPT).toContain("Recommend at most one option per question");
    expect(DEFAULT_CLARIFIER_SYSTEM_PROMPT).toContain(
      "omit `options` and ask the question directly",
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
    expect(loader.getImageDesignerPrompt()).toContain("You are the image designer subagent.");
    expect(loader.getReviewAgentPrompt()).toContain("You are the Review Agent.");
  });

  it("exports the default image designer prompt with generate and edit guidance", () => {
    expect(DEFAULT_IMAGE_DESIGNER_SYSTEM_PROMPT).toContain("generate({ prompt })");
    expect(DEFAULT_IMAGE_DESIGNER_SYSTEM_PROMPT).toContain("edit({ prompt, imageUrl })");
    expect(DEFAULT_IMAGE_DESIGNER_SYSTEM_PROMPT).toContain("Call `generate_image` exactly once");
    expect(DEFAULT_IMAGE_DESIGNER_SYSTEM_PROMPT).toContain(
      "state the requested changes directly and explicitly name what must remain unchanged",
    );
    expect(DEFAULT_IMAGE_DESIGNER_SYSTEM_PROMPT).toContain(
      "unsupported controls such as masks, seeds, negative prompts, guidance values, or model-specific parameters",
    );
    expect(DEFAULT_IMAGE_DESIGNER_SYSTEM_PROMPT).toContain(
      "editing requires an absolute source image URL",
    );
  });

  it("exports the default review agent prompt with the structured report contract", () => {
    expect(DEFAULT_REVIEW_AGENT_SYSTEM_PROMPT).toContain(
      "status`: `approved` | `changes_required` | `blocked",
    );
    expect(DEFAULT_REVIEW_AGENT_SYSTEM_PROMPT).toContain(
      "Do not rewrite the artifact unless explicitly asked",
    );
    expect(DEFAULT_REVIEW_AGENT_SYSTEM_PROMPT).toContain(
      "tests, checks, citations, or manual validation",
    );
  });

  it("uses the default markdown loader for compatibility exports", () => {
    expect(DEFAULT_PROMPT_LOADER.getSupervisorPrompt({ maxRounds: 2 })).toBe(
      DEFAULT_SUPERVISOR_SYSTEM_PROMPT,
    );
    expect(DEFAULT_PROMPT_LOADER.getClarifierPrompt({ maxRounds: 2, questionsPerRound: 3 })).toBe(
      DEFAULT_CLARIFIER_SYSTEM_PROMPT,
    );
  });
});
