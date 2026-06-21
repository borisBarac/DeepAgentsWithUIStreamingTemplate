import { describe, expect, it } from "bun:test";

import {
  MAX_SKILL_DESCRIPTION_LENGTH,
  MAX_SKILL_NAME_LENGTH,
  parseSkillMetadata,
  type SubAgent,
} from "deepagents";

import { createRuntimeScaffold } from "../scaffold/index.ts";
import {
  CLARIFY_DEEPLY_SKILL_CONTENT,
  CLARIFY_DEEPLY_SKILL_DESCRIPTION,
  CLARIFY_DEEPLY_SKILL_NAME,
  CLARIFY_DEEPLY_SKILL_PATH,
  createDefaultSkillFiles,
} from "./index.ts";

function asDefaultSubagents(subagents: unknown): SubAgent[] {
  return subagents as SubAgent[];
}

describe("bundled skills", () => {
  it("keeps clarify-deeply metadata within skill spec limits", () => {
    expect(CLARIFY_DEEPLY_SKILL_NAME.length).toBeLessThanOrEqual(MAX_SKILL_NAME_LENGTH);
    expect(CLARIFY_DEEPLY_SKILL_NAME).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
    expect(CLARIFY_DEEPLY_SKILL_DESCRIPTION.length).toBeLessThanOrEqual(
      MAX_SKILL_DESCRIPTION_LENGTH,
    );
  });

  it("ships a parsable SKILL.md file", () => {
    const metadata = parseSkillMetadata(
      "/Users/boris/Documents/dev/DeepAgentTemplate/packages/core/skills/clarify-deeply/SKILL.md",
      "project",
    );

    expect(metadata).not.toBeNull();
    expect(metadata?.name).toBe(CLARIFY_DEEPLY_SKILL_NAME);
    expect(metadata?.description).toBe(CLARIFY_DEEPLY_SKILL_DESCRIPTION);
  });

  it("describes bounded options and direct-question fallback", () => {
    expect(CLARIFY_DEEPLY_SKILL_CONTENT).toContain(
      "provide 2-4 concrete, mutually exclusive options",
    );
    expect(CLARIFY_DEEPLY_SKILL_CONTENT).toContain(
      "if useful options cannot be generated, omit them and ask the question directly",
    );
  });

  it("creates invoke-ready skill files for the state backend", () => {
    const issuedAt = new Date("2026-06-15T00:00:00.000Z");
    const files = createDefaultSkillFiles(issuedAt);

    expect(files).toEqual({
      [CLARIFY_DEEPLY_SKILL_PATH]: {
        content: CLARIFY_DEEPLY_SKILL_CONTENT,
        mimeType: "text/markdown",
        created_at: issuedAt.toISOString(),
        modified_at: issuedAt.toISOString(),
      },
    });
  });

  it("does not attach skills to any default subagent", () => {
    const [clarifier, researcher, analyst, reviewer] = asDefaultSubagents(
      createRuntimeScaffold().subagents,
    );

    expect(clarifier?.skills).toEqual([]);
    expect(researcher?.skills).toEqual([]);
    expect(analyst?.skills).toEqual([]);
    expect(reviewer?.skills).toEqual([]);
  });
});
