import { createBaselineAgent } from "@deep-agent-template/core/agent/baseline";
import { createModelRuntime } from "@deep-agent-template/core/models";

import { catalogPrompt } from "../ui/schema.ts";

export const AGENT_PROVIDER_MODE_ENV = "WEB_APP_AGENT_PROVIDER_MODE";

export type AgentProviderMode = "simple" | "advanced";

export type AgentProvider =
  | {
      mode: "simple";
      agent: ReturnType<typeof createBaselineAgent>;
    }
  | {
      mode: "advanced";
      note: string;
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
  const baseURL = process.env.LLM_BASE_URL?.trim();
  const apiKey = process.env.LLM_API_KEY?.trim();
  const model = process.env.LLM_MODEL?.trim() || "deepseek-v4-flash";

  if (!baseURL) {
    throw new Error("LLM_BASE_URL is required.");
  }
  if (!apiKey) {
    throw new Error("LLM_API_KEY is required.");
  }

  const modelRuntime = createModelRuntime({
    connections: {
      default: { provider: "openai-compatible", apiKey, baseURL },
    },
    models: {
      // Model emits raw NDJSON (one UiUpdate per line); no response_format
      // constraint needed. See packages/core/src/generative-ui/prompt.ts.
      default: { connection: "default", model },
    },
    assignments: { default: "default" },
  });

  return createBaselineAgent({
    guardrails: false,
    generativeUi: { catalogPrompt },
    modelRuntime,
    tools: [],
  });
}

export function createAgentProvider(): AgentProvider {
  const mode = getAgentProviderMode();
  if (mode === "advanced") {
    return {
      mode,
      note: "Advanced agent provider mode is not implemented yet. Set WEB_APP_AGENT_PROVIDER_MODE=simple to use the current setup.",
    };
  }

  return {
    mode,
    agent: createSimpleAgent(),
  };
}
