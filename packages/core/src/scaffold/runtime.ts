import { createClarificationConfig } from "../clarification/index.ts";
import {
  composeGenerativeUiPrompt,
  composeProductGeneratorPrompt,
} from "../generative-ui/index.ts";
import { DEFAULT_PROMPT_LOADER } from "../prompts/index.ts";
import { createDefaultCompositeBackend } from "./backend.ts";
import { DEFAULT_MEMORY_FILE_PATHS } from "./constants.ts";
import { createVirtualFilesystemLayout } from "./filesystem.ts";
import { createDefaultPermissions } from "./permissions.ts";
import { createDefaultSubagentCatalog } from "./subagents.ts";
import type {
  BaselineRuntimeScaffold,
  CreateRuntimeScaffoldOptions,
  RuntimeScaffold,
  SupervisorSpecialistsRuntimeScaffold,
} from "./types.ts";

export function createRuntimeScaffold(): SupervisorSpecialistsRuntimeScaffold;
export function createRuntimeScaffold(
  options: CreateRuntimeScaffoldOptions & { mode: "baseline" },
): BaselineRuntimeScaffold;
export function createRuntimeScaffold(
  options: CreateRuntimeScaffoldOptions & { mode?: "supervisor-specialists" },
): SupervisorSpecialistsRuntimeScaffold;
export function createRuntimeScaffold(
  options: CreateRuntimeScaffoldOptions | undefined,
): RuntimeScaffold;
export function createRuntimeScaffold(options: CreateRuntimeScaffoldOptions = {}): RuntimeScaffold {
  if (options.mode === "baseline") {
    return createBaselineRuntimeScaffold(options);
  }

  return createSupervisorSpecialistsRuntimeScaffold(options);
}

function createBaselineRuntimeScaffold(
  options: CreateRuntimeScaffoldOptions,
): BaselineRuntimeScaffold {
  const promptLoader = options.promptLoader ?? DEFAULT_PROMPT_LOADER;
  const baseSystemPrompt = promptLoader.getBaselinePrompt();
  const systemPrompt = options.generativeUi
    ? `${baseSystemPrompt}\n\n${composeGenerativeUiPrompt(options.generativeUi.catalogPrompt)}`
    : baseSystemPrompt;

  return {
    architecture: "baseline",
    virtualFilesystem: createVirtualFilesystemLayout(),
    memoryFilePaths: options.memoryFilePaths ?? [],
    backend: options.backend,
    interruptOn: options.interruptOn,
    memory: options.memory,
    permissions: options.permissions,
    subagents: options.subagents ?? [],
    systemPrompt,
    generativeUi: options.generativeUi,
  };
}

function createSupervisorSpecialistsRuntimeScaffold(
  options: CreateRuntimeScaffoldOptions,
): SupervisorSpecialistsRuntimeScaffold {
  const promptLoader = options.promptLoader ?? DEFAULT_PROMPT_LOADER;
  const clarification = createClarificationConfig(options.clarificationOptions);
  const memoryFilePaths = options.memoryFilePaths ?? DEFAULT_MEMORY_FILE_PATHS;

  const baseSystemPrompt = options.systemPrompt ?? promptLoader.getSupervisorPrompt(clarification);
  const systemPrompt = options.generativeUi
    ? `${baseSystemPrompt}\n\n${composeProductGeneratorPrompt(options.generativeUi.catalogPrompt)}`
    : baseSystemPrompt;

  return {
    architecture: "supervisor-specialists",
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
      requiredSubagent: "review-agent",
    },
    generativeUi: options.generativeUi,
  };
}
