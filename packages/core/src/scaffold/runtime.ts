import {
  createClarificationConfig,
  createClarificationTriageClassifier,
} from "../clarification/index.ts";
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

  const systemPrompt = options.systemPrompt ?? promptLoader.getSupervisorPrompt(clarification);

  const triageEnabled = clarification.triage?.enabled !== false;
  const triageClassifier = triageEnabled
    ? createClarificationTriageClassifier({
        classifier: options.triageClassifier,
        model: options.modelRuntime?.getModelForRole("triage"),
        promptLoader,
      })
    : undefined;

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
    triage: {
      enabled: triageEnabled && triageClassifier !== undefined,
      classifier: triageClassifier,
    },
    review: {
      config: review,
      requiredSubagent: "review-agent",
    },
    generativeUi: options.generativeUi,
  };
}
