import { ChatOpenAI, type ChatOpenAIFields } from "@langchain/openai";
import { ChatOpenRouter, type ChatOpenRouterInput } from "@langchain/openrouter";

export const DEFAULT_OPENROUTER_PROVIDER = "openrouter" as const;
export const DEFAULT_DEEPSEEK_MODEL = "deepseek/deepseek-v4-pro";
export const DEFAULT_MODEL_ID = `${DEFAULT_OPENROUTER_PROVIDER}:${DEFAULT_DEEPSEEK_MODEL}` as const;

export type SupportedModelProvider = typeof DEFAULT_OPENROUTER_PROVIDER;

export type ModelIdentifier =
  | string
  | {
      provider?: SupportedModelProvider;
      model?: string;
    };

export type OpenRouterModelOptions = Omit<ChatOpenRouterInput, "model"> & {
  model?: string;
};

export type CreateChatModelOptions = {
  model?: ModelIdentifier;
  openRouter?: OpenRouterModelOptions;
};

export const MODEL_ROLES = [
  "baseline",
  "supervisor",
  "clarifier",
  "researcher",
  "analyst",
  "reviewer",
  "coder",
  "judge",
  "finalizer",
] as const;

export type ModelRole = (typeof MODEL_ROLES)[number];

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
};

export type ModelRuntimeOptions = {
  modelRuntime?: ModelRuntime;
};

export type ResolvedModelIdentifier = {
  provider: SupportedModelProvider;
  model: string;
};

export function resolveModelIdentifier(
  model: ModelIdentifier = DEFAULT_MODEL_ID,
): ResolvedModelIdentifier {
  if (typeof model === "string") {
    const [provider, ...modelParts] = model.split(":");
    const modelName = modelParts.join(":");

    if (provider !== DEFAULT_OPENROUTER_PROVIDER || !modelName) {
      throw new Error(`Unsupported model identifier: ${model}`);
    }

    return {
      provider,
      model: modelName,
    };
  }

  return {
    provider: model.provider ?? DEFAULT_OPENROUTER_PROVIDER,
    model: model.model ?? DEFAULT_DEEPSEEK_MODEL,
  };
}

export function createChatModel(options: CreateChatModelOptions = {}): ChatOpenRouter {
  const resolvedModel = resolveModelIdentifier(options.model);

  switch (resolvedModel.provider) {
    case DEFAULT_OPENROUTER_PROVIDER:
      return new ChatOpenRouter({
        siteName: "Deep Agent Template",
        ...options.openRouter,
        model: options.openRouter?.model ?? resolvedModel.model,
      });
  }
}

function assertValidName(name: string, kind: string): void {
  if (name.trim() === "" || name !== name.trim()) {
    throw new Error(`${kind} names must be non-empty and cannot contain surrounding whitespace.`);
  }
}

function validateBaseURL(connectionName: string, baseURL: string): void {
  try {
    const url = new URL(baseURL);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
  } catch {
    throw new Error(
      `OpenAI-compatible connection "${connectionName}" must provide a valid HTTP(S) baseURL.`,
    );
  }
}

function validateRuntimeConfig(config: ModelRuntimeConfig): void {
  const connectionNames = Object.keys(config.connections);
  const profileNames = Object.keys(config.models);

  if (connectionNames.length === 0) {
    throw new Error("Model runtime requires at least one named connection.");
  }
  if (profileNames.length === 0) {
    throw new Error("Model runtime requires at least one named model profile.");
  }

  for (const name of connectionNames) {
    assertValidName(name, "Connection");
    const connection = config.connections[name];
    if (!connection) continue;
    const provider = (connection as { provider?: unknown }).provider;
    if (provider === "openai-compatible") {
      validateBaseURL(name, (connection as OpenAICompatibleConnectionConfig).baseURL);
    } else if (provider !== "openrouter") {
      throw new Error(`Connection "${name}" uses unsupported provider "${String(provider)}".`);
    }
  }

  for (const name of profileNames) {
    assertValidName(name, "Model profile");
    const profile = config.models[name];
    if (!profile) continue;
    if (profile.model.trim() === "") {
      throw new Error(`Model profile "${name}" must provide a non-empty model ID.`);
    }
    if (!config.connections[profile.connection]) {
      throw new Error(
        `Model profile "${name}" references unknown connection "${profile.connection}".`,
      );
    }
  }

  for (const [role, profileName] of Object.entries(config.assignments)) {
    if (role !== "default" && !MODEL_ROLES.includes(role as ModelRole)) {
      throw new Error(`Model assignment uses unknown role "${role}".`);
    }
    if (typeof profileName !== "string" || !config.models[profileName]) {
      throw new Error(
        `Model assignment "${role}" references unknown model profile "${String(profileName)}".`,
      );
    }
  }
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
    case "openrouter":
      return new ChatOpenRouter({
        ...connection.options,
        ...commonOptions,
        apiKey: connection.apiKey,
        siteName: connection.siteName ?? "Deep Agent Template",
        siteUrl: connection.siteUrl,
      });
    case "openai-compatible":
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

export function createModelRuntime(config: ModelRuntimeConfig): ModelRuntime {
  validateRuntimeConfig(config);
  const cache = new Map<string, RuntimeChatModel>();

  const getModel = (profileName: string): RuntimeChatModel => {
    const profile = config.models[profileName];
    if (!profile) {
      throw new Error(`Unknown model profile "${profileName}".`);
    }
    const cached = cache.get(profileName);
    if (cached) {
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
  };
}

export function assertCompatibleModelOptions(
  options: CreateChatModelOptions & ModelRuntimeOptions,
): void {
  if (options.modelRuntime && (options.model !== undefined || options.openRouter !== undefined)) {
    throw new Error(
      "modelRuntime cannot be combined with legacy model or openRouter options. Choose one model configuration path.",
    );
  }
}
