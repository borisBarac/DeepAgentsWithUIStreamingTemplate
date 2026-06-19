import type { OrchestratedDeepAgentState } from "./types.ts";

export function composeFinalAnswer(state: OrchestratedDeepAgentState): string {
  const sections: string[] = [];
  const answers = state.clarification?.answeredInformation ?? [];
  const stageSections: Array<{ key: "researchResult" | "codeResult"; heading: string }> = [
    { key: "researchResult", heading: "Research" },
    { key: "codeResult", heading: "Implementation" },
  ];

  if (answers.length > 0) {
    sections.push(
      `## Clarifications\n${answers.map((answer) => `- ${answer.key}: ${answer.value}`).join("\n")}`,
    );
  }
  for (const section of stageSections) {
    const content = state[section.key];
    if (content) {
      sections.push(`## ${section.heading}\n${content}`);
    }
  }
  if (sections.length === 0) {
    sections.push(state.task);
  }

  const errors = state.errors ?? [];
  if (errors.length > 0) {
    const requiredFailures = errors.filter((entry) => entry.required);
    const heading = requiredFailures.length > 0 ? "## Blocked" : "## Caveats";
    sections.push(
      `${heading}\n${errors
        .map((entry) => `- [${entry.category}] ${entry.node}: ${entry.message}`)
        .join("\n")}`,
    );
  }

  return sections.join("\n\n");
}
