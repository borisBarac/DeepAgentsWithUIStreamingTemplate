import {
  CompositeBackend,
  type CreateDeepAgentParams,
  type FilesystemPermission,
  StateBackend,
  StoreBackend,
  type StoreBackendNamespaceFactory,
  type SubAgent,
} from "deepagents";

import {
  type ClarificationConfig,
  clarificationResultSchema,
  createClarificationConfig,
} from "../clarification/index.ts";
import { DEFAULT_PROMPT_LOADER, type PromptLoader } from "../prompts/index.ts";
import { CLARIFY_DEEPLY_SKILL_DIR } from "../skills/index.ts";

export const DEFAULT_SCRATCH_ROOT = "/scratch";
export const DEFAULT_PLANS_ROOT = "/plans";
export const DEFAULT_REPORTS_ROOT = "/reports";
export const DEFAULT_ARTIFACTS_ROOT = "/artifacts";
export const DEFAULT_MEMORY_ROOT = "/memory";
export const DEFAULT_SKILLS_ROOT = "/skills";

export const DEFAULT_MEMORY_FILE_PATHS = [
  `${DEFAULT_MEMORY_ROOT}/AGENTS.md`,
  `${DEFAULT_MEMORY_ROOT}/user-preferences.md`,
] as const;

export type SpecialistRole = "researcher" | "analyst" | "critic" | "clarifier";

export type VirtualFilesystemLayout = {
  scratch: string;
  plans: string;
  reports: string;
  artifacts: string;
  memory: string;
  skills: string;
};

export type CreateCompositeBackendOptions = {
  defaultBackend?: StateBackend;
  memoryBackend?: StoreBackend;
  memoryNamespace?: string[] | StoreBackendNamespaceFactory;
};

export type CreateDefaultPermissionsOptions = {
  extraReadableRoots?: string[];
  extraWritableRoots?: string[];
  allowSkillWrites?: boolean;
  restrictReads?: boolean;
};

export type CreateDefaultSubagentsOptions = {
  researcher?: Partial<SubAgent>;
  analyst?: Partial<SubAgent>;
  critic?: Partial<SubAgent>;
  clarifier?: Partial<SubAgent>;
};

export type DeepAgentBlueprint = {
  architecture: "supervisor-specialists";
  virtualFilesystem: VirtualFilesystemLayout;
  memoryFilePaths: readonly string[];
  interruptOn: NonNullable<CreateDeepAgentParams["interruptOn"]>;
  permissions: NonNullable<CreateDeepAgentParams["permissions"]>;
  subagents: NonNullable<CreateDeepAgentParams["subagents"]>;
  clarification: {
    config: ClarificationConfig;
    requiredSubagent: "clarifier";
  };
};

export type RuntimeScaffold = DeepAgentBlueprint & {
  backend: CreateDeepAgentParams["backend"];
  memory: CreateDeepAgentParams["memory"];
  systemPrompt: string;
};

export type CreateRuntimeScaffoldOptions = CreateDefaultSubagentsOptions & {
  backend?: CreateDeepAgentParams["backend"];
  backendOptions?: CreateCompositeBackendOptions;
  clarificationOptions?: Partial<ClarificationConfig>;
  interruptOn?: CreateDeepAgentParams["interruptOn"];
  memory?: CreateDeepAgentParams["memory"];
  memoryFilePaths?: readonly string[];
  permissions?: CreateDeepAgentParams["permissions"];
  permissionOptions?: CreateDefaultPermissionsOptions;
  promptLoader?: PromptLoader;
  subagents?: CreateDeepAgentParams["subagents"];
  systemPrompt?: string;
};

const DEFAULT_WRITABLE_ROOTS = [
  DEFAULT_SCRATCH_ROOT,
  DEFAULT_PLANS_ROOT,
  DEFAULT_REPORTS_ROOT,
  DEFAULT_ARTIFACTS_ROOT,
  DEFAULT_MEMORY_ROOT,
] as const;

const DEFAULT_READ_ONLY_ROOTS = [DEFAULT_SKILLS_ROOT] as const;

function expandDirectoryRoots(roots: readonly string[]): string[] {
  return roots.flatMap((root) => [root, `${root}/**`]);
}

function mergeSubagent(base: SubAgent, override: Partial<SubAgent> | undefined): SubAgent {
  if (!override) {
    return base;
  }

  return {
    ...base,
    ...override,
    tools: override.tools ?? base.tools,
    model: override.model ?? base.model,
    middleware: override.middleware ?? base.middleware,
    interruptOn: override.interruptOn ?? base.interruptOn,
    skills: override.skills ?? base.skills,
    responseFormat: override.responseFormat ?? base.responseFormat,
    permissions: override.permissions ?? base.permissions,
  };
}

function createDefaultInterrupts(): NonNullable<CreateDeepAgentParams["interruptOn"]> {
  return {
    write_file: true,
    edit_file: true,
    execute: true,
  };
}

function createDefaultPermissions(
  options: CreateDefaultPermissionsOptions = {},
): FilesystemPermission[] {
  const readableRoots = [
    ...DEFAULT_WRITABLE_ROOTS,
    ...DEFAULT_READ_ONLY_ROOTS,
    ...(options.extraReadableRoots ?? []),
  ];
  const writableRoots = [...DEFAULT_WRITABLE_ROOTS, ...(options.extraWritableRoots ?? [])];

  const permissions: FilesystemPermission[] = [
    {
      operations: ["read"],
      paths: ["/"],
    },
    {
      operations: ["read", "write"],
      paths: expandDirectoryRoots(writableRoots),
    },
    {
      operations: ["read"],
      paths: expandDirectoryRoots(readableRoots),
    },
  ];

  if (options.allowSkillWrites) {
    permissions.splice(2, 0, {
      operations: ["write"],
      paths: expandDirectoryRoots(DEFAULT_READ_ONLY_ROOTS),
    });
  }

  if (options.restrictReads ?? true) {
    permissions.push({
      operations: ["read", "write"],
      paths: ["/**"],
      mode: "deny",
    });
  } else {
    permissions.push({
      operations: ["write"],
      paths: ["/**"],
      mode: "deny",
    });
  }

  return permissions;
}

function createDefaultSubagents(
  options: CreateDefaultSubagentsOptions = {},
  clarificationOptions: Partial<ClarificationConfig> = {},
  promptLoader: PromptLoader = DEFAULT_PROMPT_LOADER,
): SubAgent[] {
  const sharedInterrupts = createDefaultInterrupts();
  const clarification = createClarificationConfig(clarificationOptions);

  const clarifier = mergeSubagent(
    {
      name: "clarifier",
      description:
        "Gate new requests, ask only the missing high-value questions, and return structured readiness decisions.",
      systemPrompt: promptLoader.getClarifierPrompt(clarification),
      responseFormat: clarificationResultSchema,
      interruptOn: sharedInterrupts,
      tools: [],
      skills: [CLARIFY_DEEPLY_SKILL_DIR],
    },
    options.clarifier,
  );

  const researcher = mergeSubagent(
    {
      name: "researcher",
      description: "Gather evidence, collect source-backed notes, and isolate research context.",
      systemPrompt: promptLoader.getResearcherPrompt(),
      interruptOn: sharedInterrupts,
      tools: [],
      skills: [],
    },
    options.researcher,
  );

  const analyst = mergeSubagent(
    {
      name: "analyst",
      description:
        "Turn findings into structured tradeoffs, plans, and implementation-ready analysis.",
      systemPrompt: promptLoader.getAnalystPrompt(),
      interruptOn: sharedInterrupts,
      tools: [],
      skills: [],
    },
    options.analyst,
  );

  const critic = mergeSubagent(
    {
      name: "critic",
      description:
        "Challenge weak reasoning, missing evidence, and risky actions before final output.",
      systemPrompt: promptLoader.getCriticPrompt(),
      interruptOn: sharedInterrupts,
      tools: [],
      skills: [],
    },
    options.critic,
  );

  return [clarifier, researcher, analyst, critic];
}

function createVirtualFilesystemLayout(): VirtualFilesystemLayout {
  return {
    scratch: DEFAULT_SCRATCH_ROOT,
    plans: DEFAULT_PLANS_ROOT,
    reports: DEFAULT_REPORTS_ROOT,
    artifacts: DEFAULT_ARTIFACTS_ROOT,
    memory: DEFAULT_MEMORY_ROOT,
    skills: DEFAULT_SKILLS_ROOT,
  };
}

function createDefaultCompositeBackend(
  options: CreateCompositeBackendOptions = {},
): CompositeBackend {
  const defaultBackend = options.defaultBackend ?? new StateBackend();
  const memoryBackend =
    options.memoryBackend ??
    new StoreBackend({
      namespace: options.memoryNamespace,
    });

  return new CompositeBackend(defaultBackend, {
    [DEFAULT_MEMORY_ROOT]: memoryBackend,
  });
}

export function createRuntimeScaffold(options: CreateRuntimeScaffoldOptions = {}): RuntimeScaffold {
  const promptLoader = options.promptLoader ?? DEFAULT_PROMPT_LOADER;
  const clarification = createClarificationConfig(options.clarificationOptions);
  const memoryFilePaths = options.memoryFilePaths ?? DEFAULT_MEMORY_FILE_PATHS;

  return {
    architecture: "supervisor-specialists",
    virtualFilesystem: createVirtualFilesystemLayout(),
    memoryFilePaths,
    backend: options.backend ?? createDefaultCompositeBackend(options.backendOptions),
    interruptOn: options.interruptOn ?? createDefaultInterrupts(),
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
