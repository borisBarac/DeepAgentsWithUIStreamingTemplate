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
