import type { ChatOpenAI, ChatOpenAIFields } from "@langchain/openai";

import type { ModelCategory, ModelRole } from "./constants.ts";

/**
 * The `method` forwarded to `ChatOpenAI.withStructuredOutput`. Some
 * OpenAI-compatible providers reject the `@langchain/openai` default
 * (`"jsonSchema"`): DeepSeek answers `400 This response_format type is
 * unavailable now`. `"jsonMode"` (`response_format: { type: "json_object" }`)
 * is accepted and works with thinking enabled, but the prompt must mention
 * "json". `"functionCalling"` requires disabling thinking (tool_choice is
 * unsupported while thinking is on).
 */
export type StructuredOutputMethod = "jsonSchema" | "jsonMode" | "functionCalling";

export type OpenAICompatibleConnectionConfig = {
  provider: "openai-compatible";
  apiKey?: string;
  baseURL: string;
  /**
   * Default `withStructuredOutput` method for this connection. Falls back to
   * `"jsonMode"` (see {@link DEFAULT_STRUCTURED_OUTPUT_METHOD}) which is the
   * safest cross-provider default; set `"jsonSchema"` for providers that
   * support strict structured outputs (e.g. OpenAI `gpt-4o`).
   */
  structuredOutputMethod?: StructuredOutputMethod;
  options?: Omit<ChatOpenAIFields, "apiKey" | "configuration" | "model" | "useResponsesApi"> & {
    configuration?: Omit<NonNullable<ChatOpenAIFields["configuration"]>, "apiKey" | "baseURL">;
  };
};

export type ModelConnectionConfig = OpenAICompatibleConnectionConfig;

export type ModelProfileConfig = {
  connection: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  maxRetries?: number;
  timeout?: number;
  providerOptions?: Record<string, unknown>;
};

/**
 * A concrete model per category. All three categories (fast/normal/pro) must be
 * defined; multiple categories may point at the same connection + model ID when
 * no differentiation is desired.
 */
export type ModelCategoryConfigs = Record<ModelCategory, ModelProfileConfig>;

export type ModelRuntimeConfig = {
  connections: Record<string, ModelConnectionConfig>;
  categories: ModelCategoryConfigs;
  assignments: {
    default?: ModelCategory;
  } & Partial<Record<ModelRole, ModelCategory>>;
};

export type RuntimeChatModel = ChatOpenAI;

export type ModelRuntime = {
  getModelForCategory(category: ModelCategory): RuntimeChatModel;
  getCategoryForRole(role: ModelRole): ModelCategory;
  getModelForRole(role: ModelRole): RuntimeChatModel;
  hasModelForRole(role: ModelRole): boolean;
  getModelForGuardrails?(): RuntimeChatModel;
};

export type ModelRuntimeOptions = {
  modelRuntime: ModelRuntime;
};
