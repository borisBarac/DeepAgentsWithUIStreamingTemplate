import { createClarificationConfig } from "../clarification/index.ts";
import { DEFAULT_PROMPT_LOADER } from "../prompts/index.ts";
import { createDefaultCompositeBackend } from "./backend.ts";
import { DEFAULT_MEMORY_FILE_PATHS } from "./constants.ts";
import { createVirtualFilesystemLayout } from "./filesystem.ts";
import { createDefaultPermissions } from "./permissions.ts";
import { createDefaultSubagents } from "./subagents.ts";
import type { CreateRuntimeScaffoldOptions, RuntimeScaffold } from "./types.ts";

export function createRuntimeScaffold(options: CreateRuntimeScaffoldOptions = {}): RuntimeScaffold {
  const promptLoader = options.promptLoader ?? DEFAULT_PROMPT_LOADER;
  const clarification = createClarificationConfig(options.clarificationOptions);
  const memoryFilePaths = options.memoryFilePaths ?? DEFAULT_MEMORY_FILE_PATHS;

  return {
    architecture: "supervisor-specialists",
    virtualFilesystem: createVirtualFilesystemLayout(),
    memoryFilePaths,
    backend: options.backend ?? createDefaultCompositeBackend(options.backendOptions),
    interruptOn: options.interruptOn,
    memory: options.memory ?? [...memoryFilePaths],
    permissions: options.permissions ?? createDefaultPermissions(options.permissionOptions),
    subagents: options.subagents ?? createDefaultSubagents(options, clarification, promptLoader),
    systemPrompt: options.systemPrompt ?? promptLoader.getSupervisorPrompt(clarification),
    clarification: {
      config: clarification,
      requiredSubagent: "clarifier",
    },
  };
}
