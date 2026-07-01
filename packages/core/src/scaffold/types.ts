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

export type CreateDefaultSubagentsOptions = {
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

export type DeepAgentBlueprint = {
  architecture: "supervisor-specialists";
  virtualFilesystem: VirtualFilesystemLayout;
  memoryFilePaths: readonly string[];
  interruptOn: CreateDeepAgentParams["interruptOn"];
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
  generativeUi?: GenerativeUiOptions;
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
