export const OPENAI_COMPATIBLE_PROVIDER = "openai-compatible" as const;

/**
 * Every agent role that can be assigned a model category. Roles resolve to a
 * category via `assignments`; the category then resolves to a concrete model.
 */
export const MODEL_ROLES = [
  "supervisor",
  "clarifier",
  "triage",
  "researcher",
  "analyst",
  "image-designer",
  "reviewer",
  "coder",
  "finalizer",
] as const;

export type ModelRole = (typeof MODEL_ROLES)[number];

/**
 * The three tiers of model capability/cost. Every role maps to one of these,
 * and each category maps to one concrete model (connection + model ID).
 *
 *   fast   - cheap, low-latency (classification, gating, light formatting)
 *   normal - general-purpose workhorse
 *   pro    - heavy reasoning (planning, review, finalization)
 */
export const MODEL_CATEGORIES = ["fast", "normal", "pro"] as const;

export type ModelCategory = (typeof MODEL_CATEGORIES)[number];

export const DEFAULT_MODEL_CATEGORY: ModelCategory = "normal";

/**
 * Default role -> category mapping used when no explicit assignment is given.
 * `createModelRuntimeFromEnv` applies this table; raw `createModelRuntime`
 * callers provide their own `assignments` and fall back to `default`.
 */
export const DEFAULT_ROLE_CATEGORY_ASSIGNMENTS: Partial<Record<ModelRole, ModelCategory>> = {
  clarifier: "fast",
  triage: "fast",
  researcher: "normal",
  "image-designer": "normal",
  coder: "normal",
  supervisor: "pro",
  analyst: "pro",
  reviewer: "pro",
  finalizer: "pro",
};
