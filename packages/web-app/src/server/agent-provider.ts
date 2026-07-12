import { createScaffoldedAgent, type DeepAgent } from "@deep-agent-template/core/agent";
import { createModelRuntimeFromEnv } from "@deep-agent-template/core/models";
import { createImageGenerationServiceFromEnv } from "@deep-agent-template/image-gen";

import { catalogPrompt } from "../ui/schema.ts";

export function createAgentProvider(): DeepAgent {
  const modelRuntime = createModelRuntimeFromEnv({
    profiles: {
      // DeepSeek thinking mode rejects tool_choice, which the scaffold needs
      // for specialist/subagent routing.
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
