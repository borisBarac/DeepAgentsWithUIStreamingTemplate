import { describe, expect, it } from "bun:test";
import { type SubAgent } from "deepagents";

import { clarificationResultSchema } from "../clarification/index.ts";
import type { PromptLoader } from "../prompts/index.ts";
import { CLARIFY_DEEPLY_SKILL_DIR } from "../skills/index.ts";
import { createDefaultSubagents } from "./subagents.ts";

const testPromptLoader: PromptLoader = {
  getBaselinePrompt: () => "baseline prompt",
  getSupervisorPrompt: () => "supervisor prompt",
  getClarifierPrompt: () => "custom clarifier prompt",
  getResearcherPrompt: () => "custom researcher prompt",
  getAnalystPrompt: () => "custom analyst prompt",
  getCriticPrompt: () => "custom critic prompt",
};

function asDefaultSubagents(subagents: unknown): SubAgent[] {
  return subagents as SubAgent[];
}

describe("default subagents", () => {
  it("provides specialist subagents for clarification, research, analysis, and critique", () => {
    const subagents = asDefaultSubagents(createDefaultSubagents());

    expect(subagents.map((subagent) => subagent.name)).toEqual([
      "clarifier",
      "researcher",
      "analyst",
      "critic",
    ]);
    expect(subagents.map((subagent) => subagent.tools)).toEqual([[], [], [], []]);
    expect(subagents.map((subagent) => subagent.skills)).toEqual([
      [CLARIFY_DEEPLY_SKILL_DIR],
      [],
      [],
      [],
    ]);
  });

  it("uses a custom prompt loader for default subagent prompts", () => {
    const subagents = asDefaultSubagents(createDefaultSubagents({}, {}, testPromptLoader));

    expect(subagents.map((subagent) => subagent.systemPrompt)).toEqual([
      "custom clarifier prompt",
      "custom researcher prompt",
      "custom analyst prompt",
      "custom critic prompt",
    ]);
  });

  it("lets explicit subagent prompt overrides win over the prompt loader", () => {
    const [clarifier] = asDefaultSubagents(
      createDefaultSubagents(
        {
          clarifier: {
            systemPrompt: "explicit clarifier prompt",
          },
        },
        {},
        testPromptLoader,
      ),
    );

    expect(clarifier?.systemPrompt).toBe("explicit clarifier prompt");
  });

  it("enforces structured output on the default clarifier only", () => {
    const [clarifier, researcher, analyst, critic] = asDefaultSubagents(createDefaultSubagents());

    expect(clarifier?.responseFormat).toBe(clarificationResultSchema);
    expect(researcher?.responseFormat).toBeUndefined();
    expect(analyst?.responseFormat).toBeUndefined();
    expect(critic?.responseFormat).toBeUndefined();
  });

  it("lets an explicit clarifier responseFormat override the default schema", () => {
    const customSchema = clarificationResultSchema;
    const [clarifier] = createDefaultSubagents({
      clarifier: {
        responseFormat: customSchema,
      },
    }) as SubAgent[];

    expect(clarifier?.responseFormat).toBe(customSchema);
  });
});
