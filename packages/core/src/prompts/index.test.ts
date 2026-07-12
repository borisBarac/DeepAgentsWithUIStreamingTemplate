import { describe, expect, it } from "bun:test";

import {
  createClarifierSystemPrompt,
  createSupervisorSystemPrompt,
  DEFAULT_BASELINE_SYSTEM_PROMPT,
  DEFAULT_CLARIFIER_SYSTEM_PROMPT,
  DEFAULT_IMAGE_DESIGNER_SYSTEM_PROMPT,
  DEFAULT_PRODUCT_GENERATOR_SYSTEM_PROMPT,
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

  it("requires product generation and review before final delivery when generative UI is enabled", () => {
    expect(DEFAULT_SUPERVISOR_SYSTEM_PROMPT).toContain(
      "delegate to `product-generator` immediately after the clarifier returns `ready_to_proceed`",
    );
    expect(DEFAULT_SUPERVISOR_SYSTEM_PROMPT).toContain(
      "After product generation, submit the generated product batch to `review-agent`",
    );
    expect(DEFAULT_SUPERVISOR_SYSTEM_PROMPT).toContain(
      "route the work back to `product-generator` with the reviewer feedback",
    );
    expect(DEFAULT_SUPERVISOR_SYSTEM_PROMPT).toContain(
      "Deliver final work only after the reviewer approves the generated product batch",
    );
  });

  it("tells the supervisor to use memory, filesystem layout, and specialist routing", () => {
    expect(DEFAULT_SUPERVISOR_SYSTEM_PROMPT).toContain("Read `/memory/project-facts.md`");
    expect(DEFAULT_SUPERVISOR_SYSTEM_PROMPT).toContain(
      "Write only explicit user preferences and stable project facts",
    );
    expect(DEFAULT_SUPERVISOR_SYSTEM_PROMPT).toContain("Put plans in `/plans`");
    expect(DEFAULT_SUPERVISOR_SYSTEM_PROMPT).toContain(
      "Route evidence gathering to the researcher",
    );
    expect(DEFAULT_SUPERVISOR_SYSTEM_PROMPT).toContain(
      "Submit the candidate final answer to the reviewer",
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
    expect(createClarifierSystemPrompt({ maxRounds: 6, questionsPerRound: 2 })).toContain(
      "proceed using the known context and clearly stated assumptions",
    );
    expect(createSupervisorSystemPrompt({ maxRounds: 6 })).toContain(
      "If clarification remains unresolved after 6 rounds",
    );
    expect(createSupervisorSystemPrompt({ maxRounds: 6 })).toContain(
      "proceed using the known context and clearly stated assumptions instead of blocking",
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

  it("tells the product generator to revise from reviewer feedback", () => {
    expect(DEFAULT_PRODUCT_GENERATOR_SYSTEM_PROMPT).toContain(
      "If reviewer feedback is provided, treat it as required revision input",
    );
    expect(DEFAULT_PRODUCT_GENERATOR_SYSTEM_PROMPT).toContain("revised product batch");
  });

  it("uses the default markdown loader for compatibility exports", () => {
    const stripDateTime = (prompt: string): string =>
      prompt.replace(/Current date and time \([^)]*\): [^\n]*\n?/g, "");

    expect(stripDateTime(DEFAULT_PROMPT_LOADER.getSupervisorPrompt({ maxRounds: 2 }))).toBe(
      stripDateTime(DEFAULT_SUPERVISOR_SYSTEM_PROMPT),
    );
    expect(DEFAULT_PROMPT_LOADER.getClarifierPrompt({ maxRounds: 2, questionsPerRound: 3 })).toBe(
      DEFAULT_CLARIFIER_SYSTEM_PROMPT,
    );
  });

  it("injects the current date, time, and timezone into the baseline and supervisor prompts", () => {
    const before = Date.now();
    const baseline = DEFAULT_PROMPT_LOADER.getBaselinePrompt();
    const supervisor = DEFAULT_PROMPT_LOADER.getSupervisorPrompt({ maxRounds: 2 });
    const after = Date.now();

    const extractIsoMs = (prompt: string): number => {
      const match = prompt.match(/Current date and time \([^)]*\): .*; (\S+)/);
      expect(match).not.toBeNull();
      return new Date(match?.[1] as string).getTime();
    };

    for (const prompt of [baseline, supervisor]) {
      expect(prompt).not.toContain("{{currentDateTime}}");
      expect(prompt).not.toContain("{{timezone}}");
      expect(prompt).toContain("Current date and time (");

      const ts = extractIsoMs(prompt);
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    }

    expect(supervisor).toContain("If clarification remains unresolved after 2 rounds");
  });

  it("renders the timestamp at call time rather than freezing it at module load", async () => {
    const constantIso = DEFAULT_BASELINE_SYSTEM_PROMPT.match(
      /Current date and time \([^)]*\): .*; (\S+)/,
    )?.[1] as string;

    do {
      await Bun.sleep(0);
    } while (Date.now() <= new Date(constantIso).getTime());

    const fresh = DEFAULT_PROMPT_LOADER.getBaselinePrompt();
    const freshIso = fresh.match(/Current date and time \([^)]*\): .*; (\S+)/)?.[1] as string;

    expect(new Date(freshIso).getTime()).toBeGreaterThan(new Date(constantIso).getTime());
  });
});
