import {
  DEFAULT_MODEL_CATEGORY,
  DEFAULT_ROLE_CATEGORY_ASSIGNMENTS,
  type ModelCategory,
  type ModelRole,
} from "./constants.ts";
import { createModelRuntime } from "./runtime.ts";
import type { ModelProfileConfig, ModelRuntime, ModelRuntimeConfig } from "./types.ts";

const DEFAULT_LLM_MODEL = "deepseek-v4-flash";

export type ModelEnv = {
  baseURL: string;
  apiKey: string;
  fastModel: string;
  normalModel: string;
  proModel: string;
};

export type CreateModelRuntimeFromEnvOptions = {
  /**
   * Model ID for the "normal" category. Defaults to the `LLM_MODEL` env var,
   * then to the built-in default. The fast and pro categories fall back to
   * this when their own env vars are unset.
   */
  normalModel?: string;
  /**
   * Optional per-category profile overrides (e.g. temperature, providerOptions).
   * Unspecified categories get a bare `{ connection, model }` profile.
   */
  profiles?: Partial<Record<ModelCategory, Partial<ModelProfileConfig>>>;
  /**
   * Optional role -> category overrides on top of the built-in defaults.
   */
  assignments?: Partial<Record<ModelRole, ModelCategory>>;
};

function readEnv(env: NodeJS.ProcessEnv): ModelEnv {
  const baseURL = env.LLM_BASE_URL?.trim();
  const apiKey = env.LLM_API_KEY?.trim();
  if (!baseURL) {
    throw new Error("LLM_BASE_URL is required.");
  }
  if (!apiKey) {
    throw new Error("LLM_API_KEY is required.");
  }
  const normalModel = env.LLM_MODEL?.trim() || DEFAULT_LLM_MODEL;
  return {
    baseURL,
    apiKey,
    normalModel,
    fastModel: env.FAST_MODEL?.trim() || normalModel,
    proModel: env.PRO_MODEL?.trim() || normalModel,
  };
}

/**
 * Builds a `ModelRuntime` from environment variables, using a single shared
 * OpenAI-compatible connection for all three categories.
 *
 *   LLM_BASE_URL, LLM_API_KEY - shared connection (required)
 *   LLM_MODEL                 - normal category (required, the default model)
 *   FAST_MODEL                - fast category  (optional, falls back to LLM_MODEL)
 *   PRO_MODEL                 - pro category   (optional, falls back to LLM_MODEL)
 *
 * Roles are mapped to categories via the built-in
 * `DEFAULT_ROLE_CATEGORY_ASSIGNMENTS` table (overridable via `assignments`),
 * and `default` resolves to the normal category.
 */
export function createModelRuntimeFromEnv(
  options: CreateModelRuntimeFromEnvOptions = {},
): ModelRuntime {
  const env = readEnv(process.env);
  return createModelRuntimeFromEnvValues(env, options);
}

/**
 * Same as {@link createModelRuntimeFromEnv} but accepts an explicit env-shaped
 * object instead of reading `process.env`. Useful for tests and for callers
 * (like the CLI) that already resolved the values.
 */
export function createModelRuntimeFromEnvValues(
  env: ModelEnv,
  options: CreateModelRuntimeFromEnvOptions = {},
): ModelRuntime {
  const connectionName = "default";
  const base = (model: string): ModelProfileConfig => ({ connection: connectionName, model });

  const fast = { ...base(env.fastModel), ...options.profiles?.fast };
  const normal = { ...base(env.normalModel), ...options.profiles?.normal };
  const pro = { ...base(env.proModel), ...options.profiles?.pro };

  const config: ModelRuntimeConfig = {
    connections: {
      [connectionName]: {
        provider: "openai-compatible",
        apiKey: env.apiKey,
        baseURL: env.baseURL,
      },
    },
    categories: { fast, normal, pro },
    assignments: {
      default: DEFAULT_MODEL_CATEGORY,
      ...DEFAULT_ROLE_CATEGORY_ASSIGNMENTS,
      ...options.assignments,
    },
  };

  return createModelRuntime(config);
}
