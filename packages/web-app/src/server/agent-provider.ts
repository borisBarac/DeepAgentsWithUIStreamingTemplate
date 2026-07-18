import path from "node:path";

import { createScaffoldedAgent, type DeepAgent } from "@deep-agent-template/core/agent";
import { catalogPrompt } from "@deep-agent-template/core/generative-ui";
import {
  createFileSystemMemoryStore,
  createMemoryRepository,
  createMemorySeedFiles,
} from "@deep-agent-template/core/memory";
import { createModelRuntimeFromEnv } from "@deep-agent-template/core/models";
import { createImageGenerationServiceFromEnv } from "@deep-agent-template/image-gen";

function resolveWebAppDirectory(): string {
  const cwd = process.cwd();
  return path.basename(cwd) === "web-app" && path.basename(path.dirname(cwd)) === "packages"
    ? cwd
    : path.resolve(cwd, "packages/web-app");
}

function resolveMemoryRoot(): string {
  const configuredRoot = process.env.WEB_APP_MEMORY_DIR?.trim() || ".data/memory";
  return path.resolve(resolveWebAppDirectory(), configuredRoot);
}

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

export async function createAgentProvider(): Promise<DeepAgent> {
  const maxRounds = parseClarificationMaxRounds();
  const store = createFileSystemMemoryStore({ rootDir: resolveMemoryRoot() });
  const repository = createMemoryRepository({ store });

  await Promise.all(
    createMemorySeedFiles().map(async (seed) => {
      if ((await repository.read(seed.path)) === null) {
        await repository.write(seed.path, seed.content);
      }
    }),
  );

  const modelRuntime = createModelRuntimeFromEnv({});

  return createScaffoldedAgent({
    generativeUi: { catalogPrompt },
    guardrails: false,
    imageGenerationService: createImageGenerationServiceFromEnv(),
    modelRuntime,
    clarificationOptions: maxRounds !== undefined ? { maxRounds } : undefined,
    store,
  });
}
