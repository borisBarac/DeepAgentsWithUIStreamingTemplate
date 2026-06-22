import { type FileData, MAX_SKILL_DESCRIPTION_LENGTH, MAX_SKILL_NAME_LENGTH } from "deepagents";

import clarifyDeeplySkillText from "../../skills/clarify-deeply/SKILL.md" with { type: "text" };

export const CLARIFY_DEEPLY_SKILL_NAME = "clarify-deeply";
export const CLARIFY_DEEPLY_SKILL_DIR = "/skills/clarify-deeply/";
export const CLARIFY_DEEPLY_SKILL_PATH = `${CLARIFY_DEEPLY_SKILL_DIR}SKILL.md`;
export const CLARIFY_DEEPLY_SKILL_DESCRIPTION =
  "Drive toward shared understanding by asking targeted, dependency-aware questions. Use when the user's request, plan, product idea, design, goal, requirement, or task is underspecified, ambiguous, or likely to fail without clarification. Provide a recommended answer for each question when context justifies it.";
export const CLARIFY_DEEPLY_SKILL_CONTENT = clarifyDeeplySkillText;

function assertBundledSkillMetadata(): void {
  if (CLARIFY_DEEPLY_SKILL_NAME.length > MAX_SKILL_NAME_LENGTH) {
    throw new Error(
      `Bundled skill name exceeds ${MAX_SKILL_NAME_LENGTH} characters: ${CLARIFY_DEEPLY_SKILL_NAME}`,
    );
  }

  if (CLARIFY_DEEPLY_SKILL_DESCRIPTION.length > MAX_SKILL_DESCRIPTION_LENGTH) {
    throw new Error(
      `Bundled skill description exceeds ${MAX_SKILL_DESCRIPTION_LENGTH} characters: ${CLARIFY_DEEPLY_SKILL_NAME}`,
    );
  }
}

assertBundledSkillMetadata();

export function createDefaultSkillFiles(issuedAt = new Date()): Record<string, FileData> {
  const timestamp = issuedAt.toISOString();

  return {
    [CLARIFY_DEEPLY_SKILL_PATH]: {
      content: CLARIFY_DEEPLY_SKILL_CONTENT,
      mimeType: "text/markdown",
      created_at: timestamp,
      modified_at: timestamp,
    },
  };
}
