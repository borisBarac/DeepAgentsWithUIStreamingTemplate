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
  DEFAULT_ANALYST_SYSTEM_PROMPT,
  DEFAULT_CRITIC_SYSTEM_PROMPT,
  DEFAULT_RESEARCHER_SYSTEM_PROMPT,
} from "./prompts";

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

export type SpecialistRole = "researcher" | "analyst" | "critic";

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
};

export type DeepAgentBlueprint = {
  architecture: "supervisor-specialists";
  virtualFilesystem: VirtualFilesystemLayout;
  memoryFilePaths: readonly string[];
  interruptOn: NonNullable<CreateDeepAgentParams["interruptOn"]>;
  permissions: FilesystemPermission[];
  subagents: SubAgent[];
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

export function createDefaultInterrupts(): NonNullable<CreateDeepAgentParams["interruptOn"]> {
  return {
    write_file: true,
    edit_file: true,
    execute: true,
  };
}

export function createDefaultPermissions(
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

export function createDefaultSubagents(options: CreateDefaultSubagentsOptions = {}): SubAgent[] {
  const sharedInterrupts = createDefaultInterrupts();

  const researcher = mergeSubagent(
    {
      name: "researcher",
      description: "Gather evidence, collect source-backed notes, and isolate research context.",
      systemPrompt: DEFAULT_RESEARCHER_SYSTEM_PROMPT,
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
      systemPrompt: DEFAULT_ANALYST_SYSTEM_PROMPT,
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
      systemPrompt: DEFAULT_CRITIC_SYSTEM_PROMPT,
      interruptOn: sharedInterrupts,
      tools: [],
      skills: [],
    },
    options.critic,
  );

  return [researcher, analyst, critic];
}

export function createVirtualFilesystemLayout(): VirtualFilesystemLayout {
  return {
    scratch: DEFAULT_SCRATCH_ROOT,
    plans: DEFAULT_PLANS_ROOT,
    reports: DEFAULT_REPORTS_ROOT,
    artifacts: DEFAULT_ARTIFACTS_ROOT,
    memory: DEFAULT_MEMORY_ROOT,
    skills: DEFAULT_SKILLS_ROOT,
  };
}

export function createDefaultCompositeBackend(
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

export function createSupervisorBlueprint(
  options: CreateDefaultSubagentsOptions & {
    permissions?: CreateDefaultPermissionsOptions;
    memoryFilePaths?: readonly string[];
  } = {},
): DeepAgentBlueprint {
  return {
    architecture: "supervisor-specialists",
    virtualFilesystem: createVirtualFilesystemLayout(),
    memoryFilePaths: options.memoryFilePaths ?? DEFAULT_MEMORY_FILE_PATHS,
    interruptOn: createDefaultInterrupts(),
    permissions: createDefaultPermissions(options.permissions),
    subagents: createDefaultSubagents(options),
  };
}
