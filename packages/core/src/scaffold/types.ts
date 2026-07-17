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
import type { ReviewConfig } from "../review/index.ts";
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

export type RuntimeScaffoldArchitecture = "supervisor-specialists";

type RuntimeScaffoldBase = {
  virtualFilesystem: VirtualFilesystemLayout;
  memoryFilePaths: readonly string[];
  interruptOn: CreateDeepAgentParams["interruptOn"];
  backend: CreateDeepAgentParams["backend"];
  memory: CreateDeepAgentParams["memory"];
  systemPrompt: string;
  generativeUi?: GenerativeUiOptions;
};

export type SupervisorSpecialistsRuntimeScaffold = RuntimeScaffoldBase & {
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
    config: ReviewConfig;
    requiredSubagent: "review-agent";
  };
};

export type RuntimeScaffold = SupervisorSpecialistsRuntimeScaffold;

export type CreateRuntimeScaffoldOptions = CreateDefaultSubagentCatalogOptions & {
  backend?: CreateDeepAgentParams["backend"];
  backendOptions?: CreateCompositeBackendOptions;
  clarificationOptions?: Partial<ClarificationConfig>;
  reviewOptions?: Partial<ReviewConfig>;
  interruptOn?: CreateDeepAgentParams["interruptOn"];
  memory?: CreateDeepAgentParams["memory"];
  memoryFilePaths?: readonly string[];
  permissions?: CreateDeepAgentParams["permissions"];
  permissionOptions?: CreateDefaultPermissionsOptions;
  promptLoader?: PromptLoader;
  subagents?: CreateDeepAgentParams["subagents"];
  systemPrompt?: string;
};
