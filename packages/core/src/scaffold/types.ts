import type { BaseStore } from "@langchain/langgraph";
import type {
  CreateDeepAgentParams,
  StateBackend,
  StoreBackend,
  StoreBackendNamespaceFactory,
  SubAgent,
} from "deepagents";
import type { ImageGenerationServiceContract } from "../../../image-gen/src/index.ts";

import type { ClarificationConfig, ClarificationOverrideOptions } from "../clarification/index.ts";
import type { GenerativeUiOptions } from "../generative-ui/index.ts";
import type { ModelRuntime } from "../models/index.ts";
import type { PromptLoader } from "../prompts/index.ts";
import type { ReviewConfig } from "../review/index.ts";
import type { SandboxBackend, SandboxExecutionIdentity } from "../sandbox/index.ts";

export type SpecialistRole =
  | "researcher"
  | "analyst"
  | "reviewer"
  | "clarifier"
  | "product-generator"
  | "image-designer";

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

/**
 * Public override surface for a single default subagent. Mirrors {@link SubAgent}
 * minus `responseFormat`: subagents must return prose so the main agent can
 * translate that prose into typed `workflow_submit_*` tool calls. Any caller
 * that needs structured output should hook the main agent's presentation phase
 * (`generativeUi`) instead of bypassing the prose contract here.
 */
export type DefaultSubagentOverride = Omit<Partial<SubAgent>, "responseFormat">;

export type CreateDefaultSubagentCatalogOptions = {
  additionalResearcherTools?: NonNullable<SubAgent["tools"]>;
  imageGenerationService?: ImageGenerationServiceContract;
  modelRuntime?: ModelRuntime;
  pythonSandboxBackend?: SandboxBackend;
  sandboxIdentity?: SandboxExecutionIdentity;
  generativeUi?: GenerativeUiOptions;
  researcher?: DefaultSubagentOverride;
  analyst?: DefaultSubagentOverride;
  reviewer?: DefaultSubagentOverride;
  clarifier?: DefaultSubagentOverride;
  imageDesigner?: DefaultSubagentOverride;
  productGenerator?: DefaultSubagentOverride;
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
  review: {
    config: ReviewConfig;
    requiredSubagent: "review-agent";
  };
  productGeneration?: {
    enabled: true;
    requiredSubagent: "product-generator";
  };
};

export type RuntimeScaffold = SupervisorSpecialistsRuntimeScaffold;

export type CreateRuntimeScaffoldOptions = CreateDefaultSubagentCatalogOptions & {
  backend?: CreateDeepAgentParams["backend"];
  backendOptions?: CreateCompositeBackendOptions;
  clarificationOptions?: ClarificationOverrideOptions;
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
