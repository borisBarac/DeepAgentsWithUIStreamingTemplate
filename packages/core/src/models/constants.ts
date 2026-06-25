export const OPENROUTER_PROVIDER = "openrouter" as const;
export const OPENAI_COMPATIBLE_PROVIDER = "openai-compatible" as const;

export const DEFAULT_SITE_NAME = "Deep Agent Template";

export const MODEL_ROLES = [
  "baseline",
  "supervisor",
  "clarifier",
  "researcher",
  "analyst",
  "image-designer",
  "product-generator",
  "reviewer",
  "coder",
  "finalizer",
] as const;

export type ModelRole = (typeof MODEL_ROLES)[number];
