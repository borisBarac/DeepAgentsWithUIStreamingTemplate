import { ChatOpenAI } from "@langchain/openai";
import { ChatOpenRouter } from "@langchain/openrouter";

import {
  DEFAULT_MODEL_CATEGORY,
  DEFAULT_SITE_NAME,
  MODEL_CATEGORIES,
  MODEL_ROLES,
  type ModelCategory,
  type ModelRole,
  OPENAI_COMPATIBLE_PROVIDER,
  OPENROUTER_PROVIDER,
} from "./constants.ts";
import type {
  ModelConnectionConfig,
  ModelProfileConfig,
  ModelRuntime,
  ModelRuntimeConfig,
  RuntimeChatModel,
} from "./types.ts";
import { validateRuntimeConfig } from "./validation.ts";

function createRuntimeModel(
  connection: ModelConnectionConfig,
  profile: ModelProfileConfig,
): RuntimeChatModel {
  const commonOptions = {
    temperature: profile.temperature,
    maxTokens: profile.maxTokens,
    maxRetries: profile.maxRetries,
    timeout: profile.timeout,
    ...profile.providerOptions,
    model: profile.model,
  };

  switch (connection.provider) {
    case OPENROUTER_PROVIDER:
      return new ChatOpenRouter({
        ...connection.options,
        ...commonOptions,
        apiKey: connection.apiKey,
        siteName: connection.siteName ?? DEFAULT_SITE_NAME,
        siteUrl: connection.siteUrl,
      });
    case OPENAI_COMPATIBLE_PROVIDER:
      return new ChatOpenAI({
        ...connection.options,
        ...commonOptions,
        apiKey: connection.apiKey,
        useResponsesApi: false,
        configuration: {
          ...connection.options?.configuration,
          baseURL: connection.baseURL,
        },
      });
  }
}

/**
 * Creates a lazy model registry organized around three categories
 * (fast/normal/pro). Connections describe provider credentials and endpoints,
 * `categories` selects a concrete model per category on one connection, and
 * `assignments` map agent roles to categories. Models are constructed on first
 * lookup and then cached by category, so repeated calls return the same chat
 * model instance.
 *
 * Role resolution: `assignments[role] ?? assignments.default ?? "normal"`, then
 * the resolved category is turned into a chat model via `categories[category]`.
 */
export function createModelRuntime(config: ModelRuntimeConfig): ModelRuntime {
  validateRuntimeConfig(config);
  const cache = new Map<ModelCategory, RuntimeChatModel>();

  const getModelForCategory = (category: ModelCategory): RuntimeChatModel => {
    if (!MODEL_CATEGORIES.includes(category)) {
      throw new Error(`Unknown model category "${String(category)}".`);
    }
    const cached = cache.get(category);
    if (cached !== undefined) {
      return cached;
    }
    const profile = config.categories[category];
    const connection = config.connections[profile.connection];
    if (!connection) {
      throw new Error(
        `Category "${category}" references unknown connection "${profile.connection}".`,
      );
    }
    const model = createRuntimeModel(connection, profile);
    cache.set(category, model);
    return model;
  };

  const getCategoryForRole = (role: ModelRole): ModelCategory => {
    if (!MODEL_ROLES.includes(role)) {
      throw new Error(`Unknown model role "${String(role)}".`);
    }
    return config.assignments[role] ?? config.assignments.default ?? DEFAULT_MODEL_CATEGORY;
  };

  return {
    getModelForCategory,
    getCategoryForRole,
    getModelForRole(role) {
      return getModelForCategory(getCategoryForRole(role));
    },
    hasModelForRole(role) {
      if (!MODEL_ROLES.includes(role)) {
        return false;
      }
      return config.assignments[role] !== undefined || config.assignments.default !== undefined;
    },
  };
}
