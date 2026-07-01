import type { BaseStore } from "@langchain/langgraph";
import type {
  CreateDeepAgentParams,
  StateBackend,
  StoreBackend,
  StoreBackendNamespaceFactory,
  SubAgent,
} from "deepagents";
import type { ImageGenerationServiceContract } from "../../../image-gen/src/index.ts";

import type { ClarificationConfig } from "../clarification/index.ts";
import type { GenerativeUiOptions } from "../generative-ui/index.ts";
import type { ModelRuntime } from "../models/index.ts";
import type { PromptLoader } from "../prompts/index.ts";
import type { SandboxBackend } from "../sandbox/index.ts";

export type SpecialistRole =
  | "researcher"
  | "analyst"
  | "reviewer"
  | "clarifier"
  | "image-designer"
  | "product-generator";

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
  memoryStore?: BaseStore;
  memoryUserId?: string;
};

export type CreateDefaultPermissionsOptions = {
  extraReadableRoots?: string[];
  extraWritableRoots?: string[];
  allowSkillWrites?: boolean;
  restrictReads?: boolean;
};

export type CreateDefaultSubagentCatalogOptions = {
  additionalResearcherTools?: NonNullable<SubAgent["tools"]>;
  imageGenerationService?: ImageGenerationServiceContract;
  modelRuntime?: ModelRuntime;
  pythonSandboxBackend?: SandboxBackend;
  generativeUi?: GenerativeUiOptions;
  researcher?: Partial<SubAgent>;
  analyst?: Partial<SubAgent>;
  reviewer?: Partial<SubAgent>;
  clarifier?: Partial<SubAgent>;
  imageDesigner?: Partial<SubAgent>;
  productGenerator?: Partial<SubAgent>;
};

export type DefaultSubagentCatalog = {
  byRole: Record<SpecialistRole, SubAgent | undefined>;
  all: SubAgent[];
};

export type RuntimeScaffoldArchitecture = "baseline" | "supervisor-specialists";

type RuntimeScaffoldBase = {
  architecture: RuntimeScaffoldArchitecture;
  virtualFilesystem: VirtualFilesystemLayout;
  memoryFilePaths: readonly string[];
  interruptOn: CreateDeepAgentParams["interruptOn"];
  backend: CreateDeepAgentParams["backend"];
  memory: CreateDeepAgentParams["memory"];
  systemPrompt: string;
  generativeUi?: GenerativeUiOptions;
};

export type SupervisorSpecialistsRuntimeScaffold = RuntimeScaffoldBase & {
  architecture: "supervisor-specialists";
  permissions: NonNullable<CreateDeepAgentParams["permissions"]>;
  subagents: NonNullable<CreateDeepAgentParams["subagents"]>;
  clarification: {
    config: ClarificationConfig;
    requiredSubagent: "clarifier";
  };
  productGeneration: {
    enabled: boolean;
    requiredSubagent?: "product-generator";
  };
  review: {
    requiredSubagent: "review-agent";
  };
};

export type BaselineRuntimeScaffold = RuntimeScaffoldBase & {
  architecture: "baseline";
  permissions: CreateDeepAgentParams["permissions"];
  subagents: NonNullable<CreateDeepAgentParams["subagents"]>;
  clarification?: never;
  productGeneration?: never;
  review?: never;
};

export type DeepAgentBlueprint = SupervisorSpecialistsRuntimeScaffold | BaselineRuntimeScaffold;
export type RuntimeScaffold = DeepAgentBlueprint;

export type CreateRuntimeScaffoldOptions = CreateDefaultSubagentCatalogOptions & {
  mode?: RuntimeScaffoldArchitecture;
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
