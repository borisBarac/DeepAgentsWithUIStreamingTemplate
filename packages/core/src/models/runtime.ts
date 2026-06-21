import { ChatOpenAI } from "@langchain/openai";
import { ChatOpenRouter } from "@langchain/openrouter";

import {
  DEFAULT_SITE_NAME,
  MODEL_ROLES,
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
 * Creates a lazy model registry for named profiles and role-based assignments.
 *
 * Connections describe provider credentials and endpoints, model profiles select
 * a concrete model on one connection, and assignments map agent roles to those
 * profiles. Models are constructed on first lookup and then cached by profile
 * name, so repeated `getModel(...)` or `getModelForRole(...)` calls return the
 * same chat model instance.
 *
 * Role-specific assignments take precedence over `assignments.default`. If a
 * role has no explicit assignment and no default is configured,
 * `getModelForRole(...)` throws.
 */
export function createModelRuntime(config: ModelRuntimeConfig): ModelRuntime {
  validateRuntimeConfig(config);
  const cache = new Map<string, RuntimeChatModel>();

  const getModel = (profileName: string): RuntimeChatModel => {
    const profile = config.models[profileName];
    if (!profile) {
      throw new Error(`Unknown model profile "${profileName}".`);
    }
    const cached = cache.get(profileName);
    if (cached !== undefined) {
      return cached;
    }
    const connection = config.connections[profile.connection];
    if (!connection) {
      throw new Error(
        `Model profile "${profileName}" references unknown connection "${profile.connection}".`,
      );
    }
    const model = createRuntimeModel(connection, profile);
    cache.set(profileName, model);
    return model;
  };

  return {
    getModel,
    getModelForRole(role) {
      if (!MODEL_ROLES.includes(role)) {
        throw new Error(`Unknown model role "${String(role)}".`);
      }
      const profileName = config.assignments[role] ?? config.assignments.default;
      if (!profileName) {
        throw new Error(
          `No model assignment configured for role "${role}" and no default assignment is available.`,
        );
      }
      return getModel(profileName);
    },
    hasModelForRole(role) {
      if (!MODEL_ROLES.includes(role)) {
        return false;
      }
      return config.assignments[role] !== undefined || config.assignments.default !== undefined;
    },
  };
}
