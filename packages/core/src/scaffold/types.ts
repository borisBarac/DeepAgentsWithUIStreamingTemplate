import type {
  CreateDeepAgentParams,
  StateBackend,
  StoreBackend,
  StoreBackendNamespaceFactory,
  SubAgent,
} from "deepagents";

import type { ClarificationConfig } from "../clarification/index.ts";
import type { PromptLoader } from "../prompts/index.ts";

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
