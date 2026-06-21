export const OPENROUTER_PROVIDER = "openrouter" as const;
export const OPENAI_COMPATIBLE_PROVIDER = "openai-compatible" as const;

export const DEFAULT_SITE_NAME = "Deep Agent Template";

export const MODEL_ROLES = [
  "baseline",
  "supervisor",
  "gatekeeper",
  "clarifier",
  "researcher",
  "analyst",
  "reviewer",
  "coder",
  "finalizer",
] as const;

export type ModelRole = (typeof MODEL_ROLES)[number];
