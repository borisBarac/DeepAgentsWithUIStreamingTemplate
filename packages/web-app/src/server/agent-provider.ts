import { createScaffoldedAgent, type DeepAgent } from "@deep-agent-template/core/agent";
import { createModelRuntimeFromEnv } from "@deep-agent-template/core/models";
import { createImageGenerationServiceFromEnv } from "@deep-agent-template/image-gen";

import { catalogPrompt } from "../ui/schema.ts";

function parseClarificationMaxRounds(): number | undefined {
  const raw = process.env.WEB_APP_CLARIFICATION_MAX_ROUNDS;
  if (raw === undefined || raw === "") {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(
      `WEB_APP_CLARIFICATION_MAX_ROUNDS must be a positive integer, received "${raw}".`,
    );
  }
  return parsed;
}

export function createAgentProvider(): DeepAgent {
  const modelRuntime = createModelRuntimeFromEnv({});

  const maxRounds = parseClarificationMaxRounds();

  return createScaffoldedAgent({
    generativeUi: { catalogPrompt },
    guardrails: false,
    imageGenerationService: createImageGenerationServiceFromEnv(),
    modelRuntime,
    clarificationOptions: maxRounds !== undefined ? { maxRounds } : undefined,
  });
}
