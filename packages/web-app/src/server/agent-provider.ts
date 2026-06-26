import {
  createBaselineAgent,
  createScaffoldedAgent,
  type DeepAgent,
} from "@deep-agent-template/core/agent";
import { createModelRuntimeFromEnv } from "@deep-agent-template/core/models";
import { createImageGenerationServiceFromEnv } from "@deep-agent-template/image-gen";

import { catalogPrompt } from "../ui/schema.ts";

export const AGENT_PROVIDER_MODE_ENV = "WEB_APP_AGENT_PROVIDER_MODE";

export type AgentProviderMode = "simple" | "advanced";

export type AgentProvider = {
  mode: AgentProviderMode;
  agent: DeepAgent;
};

function normalizeMode(value: string): AgentProviderMode {
  const mode = value.trim().toLowerCase();
  if (mode === "simple" || mode === "advanced") {
    return mode;
  }
  throw new Error(`${AGENT_PROVIDER_MODE_ENV} must be "simple" or "advanced" when set.`);
}

export function getAgentProviderMode(): AgentProviderMode {
  const rawMode = process.env[AGENT_PROVIDER_MODE_ENV]?.trim();
  if (!rawMode) {
    return "simple";
  }
  return normalizeMode(rawMode);
}

function createSimpleAgent() {
  const modelRuntime = createModelRuntimeFromEnv();

  return createBaselineAgent({
    guardrails: false,
    generativeUi: { catalogPrompt },
    modelRuntime,
    tools: [],
  });
}

function createAdvancedAgent() {
  const modelRuntime = createModelRuntimeFromEnv({
    profiles: {
      // DeepSeek thinking mode rejects tool_choice, which the scaffold needs for
      // specialist/subagent routing. Keep this scoped to advanced mode so the
      // simple baseline can use provider defaults.
      fast: { providerOptions: { modelKwargs: { thinking: { type: "disabled" } } } },
      normal: { providerOptions: { modelKwargs: { thinking: { type: "disabled" } } } },
      pro: { providerOptions: { modelKwargs: { thinking: { type: "disabled" } } } },
    },
  });

  return createScaffoldedAgent({
    generativeUi: { catalogPrompt },
    guardrails: false,
    imageGenerationService: createImageGenerationServiceFromEnv(),
    modelRuntime,
  });
}

export function createAgentProvider(): AgentProvider {
  const mode = getAgentProviderMode();
  const agent = mode === "simple" ? createSimpleAgent() : createAdvancedAgent();

  return { mode, agent };
}
