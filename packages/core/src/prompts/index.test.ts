import { describe, expect, it } from "bun:test";

import {
  CORE_PROMPT_TEMPLATES,
  createClarifierSystemPrompt,
  createSupervisorSystemPrompt,
  DEFAULT_CLARIFIER_SYSTEM_PROMPT,
  DEFAULT_IMAGE_DESIGNER_SYSTEM_PROMPT,
  DEFAULT_PRODUCT_GENERATOR_SYSTEM_PROMPT,
  DEFAULT_PROMPT_LOADER,
  DEFAULT_REVIEW_AGENT_SYSTEM_PROMPT,
  DEFAULT_SUPERVISOR_SYSTEM_PROMPT,
  MarkdownPromptLoader,
  renderPromptTemplate,
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
      "Send every new top-level request to `clarifier` before normal work.",
    );
    expect(DEFAULT_SUPERVISOR_SYSTEM_PROMPT).toContain(
      "Follow this order: bounded clarification; execution and artifact creation; product generation when enabled; unified review; autonomous revision and resubmission; final delivery.",
    );
  });

  it("tells the supervisor to relay clarifier questions verbatim", () => {
    expect(DEFAULT_SUPERVISOR_SYSTEM_PROMPT).toContain(
      "relay only its exact questions and options",
    );
    expect(DEFAULT_SUPERVISOR_SYSTEM_PROMPT).toContain("Users may answer outside offered options");
    expect(DEFAULT_SUPERVISOR_SYSTEM_PROMPT).toContain(
      "Do not rewrite, add, remove, merge, or reorder them",
    );
  });

  it("requires product generation and review before final delivery when generative UI is enabled", () => {
    expect(DEFAULT_SUPERVISOR_SYSTEM_PROMPT).toContain(
      "product generation is mandatory after the non-product deliverables exist",
    );
    expect(DEFAULT_SUPERVISOR_SYSTEM_PROMPT).toContain("send `review-agent` one context packet");
    expect(DEFAULT_SUPERVISOR_SYSTEM_PROMPT).toContain("regenerate affected products");
    expect(DEFAULT_SUPERVISOR_SYSTEM_PROMPT).toContain("latest unresolved reviewer findings");
  });

  it("tells the supervisor to use memory, filesystem layout, and specialist routing", () => {
    expect(DEFAULT_SUPERVISOR_SYSTEM_PROMPT).toContain("Read `/memory/project-facts.md`");
    expect(DEFAULT_SUPERVISOR_SYSTEM_PROMPT).toContain(
      "Persist only explicit preferences and stable facts",
    );
    expect(DEFAULT_SUPERVISOR_SYSTEM_PROMPT).toContain("Put plans in `/plans`");
    expect(DEFAULT_SUPERVISOR_SYSTEM_PROMPT).toContain("Route evidence gathering to `researcher`");
    expect(DEFAULT_SUPERVISOR_SYSTEM_PROMPT).toContain("candidate final response");
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
      "list the explicit assumptions execution should use",
    );
    expect(createSupervisorSystemPrompt({ maxRounds: 6 })).toContain(
      "If clarification remains unresolved after 6 rounds",
    );
    expect(createSupervisorSystemPrompt({ maxRounds: 6 })).toContain(
      "proceed with explicit assumptions",
    );
  });

  it("loads default prompts from the markdown prompt loader", () => {
    const loader = new MarkdownPromptLoader();

    expect(loader.getResearcherPrompt()).toContain("You are the researcher subagent.");
    expect(loader.getAnalystPrompt()).toContain("You are the analyst subagent.");
    expect(loader.getImageDesignerPrompt()).toContain("You are the image designer subagent.");
    expect(loader.getReviewAgentPrompt()).toContain("You are the Review Agent.");
  });

  it("loads and fully renders every internal prompt template", () => {
    const values = {
      componentPropsCatalog: "- Button: {}",
      componentTypeUnion: '"Button"',
      request: "Build a button",
      requiredContext: "Repository context",
      allowedTasks: "Software work",
      disallowedTasks: "None",
      schema: '{"type":"object"}',
    };

    for (const template of Object.values(CORE_PROMPT_TEMPLATES)) {
      expect(template.trim()).not.toBe("");
      expect(renderPromptTemplate(template, values)).not.toMatch(/{{[^}]+}}/);
    }
  });

  it("requires atomic JSON object repair", () => {
    expect(CORE_PROMPT_TEMPLATES.uiRepairFeedback).toContain("one complete corrected JSON object");
    expect(CORE_PROMPT_TEMPLATES.uiRepairFeedback).toContain("full `updates` array");
    expect(CORE_PROMPT_TEMPLATES.uiRepairFeedback).not.toContain("NDJSON");
  });

  it("defines valid ui root identity and replacement rules", () => {
    expect(CORE_PROMPT_TEMPLATES.generativeUiJsonObject).toContain('"type": "product-card"');
    expect(CORE_PROMPT_TEMPLATES.generativeUiJsonObject).toContain(
      "Each independent ui update must use a unique `spec.root` value",
    );
    expect(CORE_PROMPT_TEMPLATES.generativeUiJsonObject).toContain(
      "keeps only the last ui update for a repeated root",
    );
  });

  it("keeps centralized model-facing instructions out of TypeScript source", async () => {
    const forbidden = [
      "Return one JSON object",
      "Respond with a single JSON object matching the requested schema",
      "You are a strict content-safety classifier",
      "You are a strict task-scope classifier",
      "The following UI updates were rejected during validation",
      "Use ProductGrid as the root when showing multiple products",
    ];
    const files = await Array.fromAsync(
      new Bun.Glob("**/*.ts").scan({ cwd: `${import.meta.dir}/..`, absolute: true }),
    );
    const source = (
      await Promise.all(
        files.filter((file) => !file.endsWith(".test.ts")).map((file) => Bun.file(file).text()),
      )
    ).join("\n");

    for (const instruction of forbidden) {
      expect(source).not.toContain(instruction);
    }
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
    expect(DEFAULT_PRODUCT_GENERATOR_SYSTEM_PROMPT).toContain("complete batch");
    expect(DEFAULT_PRODUCT_GENERATOR_SYSTEM_PROMPT).toContain(
      "one JSON object with a `products` array",
    );
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

  it("injects the current date, time, and timezone into the supervisor prompt", () => {
    const before = Date.now();
    const supervisor = DEFAULT_PROMPT_LOADER.getSupervisorPrompt({ maxRounds: 2 });
    const after = Date.now();

    const extractIsoMs = (prompt: string): number => {
      const match = prompt.match(/Current date and time \([^)]*\): .*; (\S+)/);
      expect(match).not.toBeNull();
      return new Date(match?.[1] as string).getTime();
    };

    expect(supervisor).not.toContain("{{currentDateTime}}");
    expect(supervisor).not.toContain("{{timezone}}");
    expect(supervisor).toContain("Current date and time (");

    const ts = extractIsoMs(supervisor);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);

    expect(supervisor).toContain("If clarification remains unresolved after 2 rounds");
  });

  it("renders the timestamp at call time rather than freezing it at module load", async () => {
    const constantIso = DEFAULT_SUPERVISOR_SYSTEM_PROMPT.match(
      /Current date and time \([^)]*\): .*; (\S+)/,
    )?.[1] as string;

    do {
      await Bun.sleep(0);
    } while (Date.now() <= new Date(constantIso).getTime());

    const fresh = DEFAULT_PROMPT_LOADER.getSupervisorPrompt({ maxRounds: 2 });
    const freshIso = fresh.match(/Current date and time \([^)]*\): .*; (\S+)/)?.[1] as string;

    expect(new Date(freshIso).getTime()).toBeGreaterThan(new Date(constantIso).getTime());
  });
});
