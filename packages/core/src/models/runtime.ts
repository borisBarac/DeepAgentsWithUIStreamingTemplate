import { ChatOpenAI } from "@langchain/openai";

import {
  DEFAULT_MODEL_CATEGORY,
  MODEL_CATEGORIES,
  MODEL_ROLES,
  type ModelCategory,
  type ModelRole,
  OPENAI_COMPATIBLE_PROVIDER,
} from "./constants.ts";
import type {
  ModelConnectionConfig,
  ModelProfileConfig,
  ModelRuntime,
  ModelRuntimeConfig,
  RuntimeChatModel,
  StructuredOutputMethod,
} from "./types.ts";
import { validateRuntimeConfig } from "./validation.ts";

/**
 * Default `withStructuredOutput` method for OpenAI-compatible connections.
 * `"jsonMode"` (`response_format: { type: "json_object" }`) is chosen over the
 * `@langchain/openai` default (`"jsonSchema"`) because DeepSeek — and other
 * compatible providers — reject `json_schema` with
 * `400 This response_format type is unavailable now`. `json_object` is accepted
 * and works with thinking enabled (no need to disable it). Override
 * per-connection via `OpenAICompatibleConnectionConfig.structuredOutputMethod`.
 *
 * NOTE: when using `jsonMode`, the prompt MUST mention "json" or the provider
 * rejects the request (`400 Prompt must contain the word 'json'`). The scaffold
 * and guardrails ensure this.
 */
export const DEFAULT_STRUCTURED_OUTPUT_METHOD: StructuredOutputMethod = "jsonMode";

type WithStructuredOutput = ChatOpenAI["withStructuredOutput"];

/**
 * Adds a default `withStructuredOutput` method to a concrete model instance.
 * This avoids subclassing LangChain's overloaded method, whose declaration is
 * intentionally narrow and changes across minor releases.
 */
function withDefaultStructuredOutputMethod(
  model: ChatOpenAI,
  defaultStructuredOutputMethod: StructuredOutputMethod,
): RuntimeChatModel {
  const original = model.withStructuredOutput.bind(model) as WithStructuredOutput;
  model.withStructuredOutput = ((schema: unknown, config?: { method?: StructuredOutputMethod }) =>
    original(
      schema as never,
      {
        ...config,
        method: config?.method ?? defaultStructuredOutputMethod,
      } as never,
    )) as WithStructuredOutput;
  return model;
}

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
    case OPENAI_COMPATIBLE_PROVIDER:
      return withDefaultStructuredOutputMethod(
        new ChatOpenAI({
          ...connection.options,
          ...commonOptions,
          apiKey: connection.apiKey,
          useResponsesApi: false,
          configuration: {
            ...connection.options?.configuration,
            baseURL: connection.baseURL,
          },
        }),
        connection.structuredOutputMethod ?? DEFAULT_STRUCTURED_OUTPUT_METHOD,
      );
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
  let guardrailsModel: RuntimeChatModel | undefined;

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

  const getModelForGuardrails = (): RuntimeChatModel => {
    if (guardrailsModel) {
      return guardrailsModel;
    }
    const baseProfile = config.categories.fast;
    const baseProviderOptions = (baseProfile.providerOptions ?? {}) as Record<string, unknown>;
    const baseModelKwargs = (baseProviderOptions.modelKwargs ?? {}) as Record<string, unknown>;
    const profile: ModelProfileConfig = {
      ...baseProfile,
      providerOptions: {
        ...baseProviderOptions,
        modelKwargs: {
          ...baseModelKwargs,
          thinking: { type: "disabled" },
        },
      },
    };
    const connection = config.connections[profile.connection];
    if (!connection) {
      throw new Error(`Category "fast" references unknown connection "${profile.connection}".`);
    }
    guardrailsModel = createRuntimeModel(connection, profile);
    return guardrailsModel;
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
    getModelForGuardrails,
  };
}
