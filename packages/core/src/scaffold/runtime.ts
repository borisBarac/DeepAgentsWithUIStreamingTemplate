import { createClarificationConfig } from "../clarification/index.ts";
import { DEFAULT_PROMPT_LOADER, withFilesystemContract } from "../prompts/index.ts";
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

function assertRequiredSubagentsPresent(
  subagents: RuntimeScaffold["subagents"],
  options: CreateRuntimeScaffoldOptions,
): void {
  // When the caller explicitly provides `options.subagents`, they own the
  // resulting catalog — many tests intentionally pass a subset (e.g. just the
  // clarifier, or an empty list for memory-only scenarios). The required-
  // subagent contract is only enforced for the default catalog path, where
  // omitting a required subagent would silently break the workflow.
  if (options.subagents !== undefined) return;
  const present = new Set(subagents.map((subagent) => subagent.name));
  const required = ["clarifier", "review-agent"];
  if (options.generativeUi) required.push("product-generator");
  const missing = required.filter((name) => !present.has(name));
  if (missing.length > 0) {
    throw new Error(
      `createRuntimeScaffold is missing required subagent(s): ${missing.join(", ")}.`,
    );
  }
}

function createSupervisorSpecialistsRuntimeScaffold(
  options: CreateRuntimeScaffoldOptions,
): RuntimeScaffold {
  const promptLoader = options.promptLoader ?? DEFAULT_PROMPT_LOADER;
  const clarification = createClarificationConfig(options.clarificationOptions);
  const review = createReviewConfig(options.reviewOptions);
  const memoryFilePaths = options.memoryFilePaths ?? DEFAULT_MEMORY_FILE_PATHS;

  const systemPrompt = withFilesystemContract(
    options.systemPrompt ?? promptLoader.getSupervisorPrompt(clarification),
  );
  // Idempotent: default catalog pre-wraps via mergeSubagent, but user-supplied subagents may not.
  const subagents = (
    options.subagents ?? createDefaultSubagentCatalog(options, clarification, promptLoader).all
  ).map((subagent) =>
    "systemPrompt" in subagent && typeof subagent.systemPrompt === "string"
      ? { ...subagent, systemPrompt: withFilesystemContract(subagent.systemPrompt) }
      : subagent,
  );

  assertRequiredSubagentsPresent(subagents, options);

  return {
    virtualFilesystem: createVirtualFilesystemLayout(),
    memoryFilePaths,
    backend: options.backend ?? createDefaultCompositeBackend(options.backendOptions),
    interruptOn: options.interruptOn,
    memory: options.memory ?? [...memoryFilePaths],
    permissions: options.permissions ?? createDefaultPermissions(options.permissionOptions),
    subagents,
    systemPrompt,
    clarification: {
      config: clarification,
      requiredSubagent: "clarifier",
    },
    review: {
      config: review,
      requiredSubagent: "review-agent",
    },
    ...(options.generativeUi
      ? {
          productGeneration: {
            enabled: true as const,
            requiredSubagent: "product-generator" as const,
          },
        }
      : {}),
    generativeUi: options.generativeUi,
  };
}
