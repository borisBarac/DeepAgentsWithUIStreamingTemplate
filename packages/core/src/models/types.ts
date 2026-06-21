import type { ChatOpenAI, ChatOpenAIFields } from "@langchain/openai";
import type { ChatOpenRouter, ChatOpenRouterInput } from "@langchain/openrouter";

import type { ModelRole } from "./constants.ts";

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

export type ModelRuntimeConfig = {
  connections: Record<string, ModelConnectionConfig>;
  models: Record<string, ModelProfileConfig>;
  assignments: {
    default?: string;
  } & Partial<Record<ModelRole, string>>;
};

export type RuntimeChatModel = ChatOpenRouter | ChatOpenAI;

export type ModelRuntime = {
  getModel(profile: string): RuntimeChatModel;
  getModelForRole(role: ModelRole): RuntimeChatModel;
  hasModelForRole(role: ModelRole): boolean;
};

export type ModelRuntimeOptions = {
  modelRuntime: ModelRuntime;
};
