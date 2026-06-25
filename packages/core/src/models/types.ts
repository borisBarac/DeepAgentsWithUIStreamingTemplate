import type { ChatOpenAI, ChatOpenAIFields } from "@langchain/openai";
import type { ChatOpenRouter, ChatOpenRouterInput } from "@langchain/openrouter";

import type { ModelCategory, ModelRole } from "./constants.ts";

export type OpenRouterConnectionConfig = {
  provider: "openrouter";
  apiKey?: string;
  siteName?: string;
  siteUrl?: string;
  options?: Omit<ChatOpenRouterInput, "apiKey" | "model" | "siteName" | "siteUrl">;
};

export type OpenAICompatibleConnectionConfig = {
  provider: "openai-compatible";
  apiKey?: string;
  baseURL: string;
  options?: Omit<ChatOpenAIFields, "apiKey" | "configuration" | "model" | "useResponsesApi"> & {
    configuration?: Omit<NonNullable<ChatOpenAIFields["configuration"]>, "apiKey" | "baseURL">;
  };
};

export type ModelConnectionConfig = OpenRouterConnectionConfig | OpenAICompatibleConnectionConfig;

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

export type RuntimeChatModel = ChatOpenRouter | ChatOpenAI;

export type ModelRuntime = {
  getModelForCategory(category: ModelCategory): RuntimeChatModel;
  getCategoryForRole(role: ModelRole): ModelCategory;
  getModelForRole(role: ModelRole): RuntimeChatModel;
  hasModelForRole(role: ModelRole): boolean;
};

export type ModelRuntimeOptions = {
  modelRuntime: ModelRuntime;
};
