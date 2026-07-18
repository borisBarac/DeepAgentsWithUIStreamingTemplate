import { StructuredOutputParsingError } from "langchain";

export function hasStructuredOutputParsingCause(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current = error;
  while (current != null && !seen.has(current)) {
    if (current instanceof StructuredOutputParsingError) return true;
    seen.add(current);
    if (typeof current !== "object" || !("cause" in current)) return false;
    current = current.cause;
  }
  return false;
}
