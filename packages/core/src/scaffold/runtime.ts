import { createClarificationConfig } from "../clarification/index.ts";
import { composeProductGeneratorPrompt } from "../generative-ui/index.ts";
import { DEFAULT_PROMPT_LOADER } from "../prompts/index.ts";
import { createReviewConfig } from "../review/index.ts";
import { createDefaultCompositeBackend } from "./backend.ts";
import { DEFAULT_MEMORY_FILE_PATHS } from "./constants.ts";
import { createVirtualFilesystemLayout } from "./filesystem.ts";
import { createDefaultPermissions } from "./permissions.ts";
import { createDefaultSubagentCatalog } from "./subagents.ts";
import type { CreateRuntimeScaffoldOptions, RuntimeScaffold } from "./types.ts";

export function createRuntimeScaffold(options: CreateRuntimeScaffoldOptions = {}): RuntimeScaffold {
  return createSupervisorSpecialistsRuntimeScaffold(options);
}

function createSupervisorSpecialistsRuntimeScaffold(
  options: CreateRuntimeScaffoldOptions,
): RuntimeScaffold {
  const promptLoader = options.promptLoader ?? DEFAULT_PROMPT_LOADER;
  const clarification = createClarificationConfig(options.clarificationOptions);
  const review = createReviewConfig(options.reviewOptions);
  const memoryFilePaths = options.memoryFilePaths ?? DEFAULT_MEMORY_FILE_PATHS;

  const baseSystemPrompt = options.systemPrompt ?? promptLoader.getSupervisorPrompt(clarification);
  const systemPrompt = options.generativeUi
    ? `${baseSystemPrompt}\n\n${composeProductGeneratorPrompt(options.generativeUi.catalogPrompt)}`
    : baseSystemPrompt;

  return {
    virtualFilesystem: createVirtualFilesystemLayout(),
    memoryFilePaths,
    backend: options.backend ?? createDefaultCompositeBackend(options.backendOptions),
    interruptOn: options.interruptOn,
    memory: options.memory ?? [...memoryFilePaths],
    permissions: options.permissions ?? createDefaultPermissions(options.permissionOptions),
    subagents:
      options.subagents ?? createDefaultSubagentCatalog(options, clarification, promptLoader).all,
    systemPrompt,
    clarification: {
      config: clarification,
      requiredSubagent: "clarifier",
    },
    productGeneration: {
      enabled: Boolean(options.generativeUi),
      ...(options.generativeUi ? { requiredSubagent: "product-generator" as const } : {}),
    },
    review: {
      config: review,
      requiredSubagent: "review-agent",
    },
    generativeUi: options.generativeUi,
  };
}
