/**
 * Display labels for subagent names. The supervisor delegates via the `task`
 * tool's `subagent_type` argument, which carries a kebab-case identifier
 * (`researcher`, `general-purpose`, etc.). Render those identifiers through
 * {@link labelSubagent} so the UI shows humanized names instead.
 *
 * Identity/dedup keys in `use-agent-chat.ts` continue to use the raw
 * `subagentName` — labels are presentation-only.
 */
const SUBAGENT_LABELS: Record<string, string> = {
  "general-purpose": "General purpose",
  clarifier: "Clarifier",
  researcher: "Researcher",
  analyst: "Analyst",
  "review-agent": "Reviewer",
  reviewer: "Reviewer",
  "product-generator": "Product generator",
  "image-designer": "Image designer",
  coordinator: "Main agent",
};

/**
 * Convert a raw subagent name to a human-friendly label. Unknown names fall
 * back to title-cased kebab→space conversion (e.g. `"my-custom-agent"` →
 * `"My Custom Agent"`). `undefined`/`null`/empty inputs return `"Subagent"`.
 */
export function labelSubagent(subagentName: string | undefined | null): string {
  if (!subagentName) return "Subagent";
  const known = SUBAGENT_LABELS[subagentName];
  if (known) return known;
  return subagentName
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export const KNOWN_SUBAGENT_LABELS: Readonly<Record<string, string>> = SUBAGENT_LABELS;
