import { type CreateDeepAgentParams, createDeepAgent, type DeepAgent } from "deepagents";

import type { ClarificationConfig } from "./clarification";
import {
  type CreateDefaultGuardrailsOptions,
  createDefaultGuardrails,
  type DeepAgentMiddleware,
  type StructuredTaskScopeModel,
} from "./guardrails";
import { type CreateChatModelOptions, createChatModel } from "./models";
import { configureLangSmithTracing, type LangSmithTracingOptions } from "./observability";
import { DEFAULT_PROMPT_LOADER, DEFAULT_SYSTEM_PROMPT, type PromptLoader } from "./prompts";
import {
  type CreateCompositeBackendOptions,
  type CreateDefaultPermissionsOptions,
  type CreateDefaultSubagentsOptions,
  type CreateSupervisorBlueprintOptions,
  createDefaultCompositeBackend,
  createSupervisorBlueprint,
} from "./scaffold";

export const DEFAULT_AGENT_NAME = "deep-agent-template";

type DeepAgentScaffoldOptions = Pick<
  CreateDeepAgentParams,
  | "backend"
  | "checkpointer"
  | "interruptOn"
  | "memory"
  | "middleware"
  | "permissions"
  | "responseFormat"
  | "skills"
  | "store"
  | "streamTransformers"
  | "subagents"
  | "tools"
>;

export type CreateBaselineAgentOptions = DeepAgentScaffoldOptions &
  CreateChatModelOptions & {
    guardrails?: false | CreateDefaultGuardrailsOptions;
    name?: string;
    promptLoader?: PromptLoader;
    systemPrompt?: string;
    langSmith?: LangSmithTracingOptions;
  };

export type CreateScaffoldedAgentOptions = Omit<
  CreateBaselineAgentOptions,
  "backend" | "interruptOn" | "permissions" | "subagents"
> & {
  backend?: CreateDeepAgentParams["backend"];
  backendOptions?: CreateCompositeBackendOptions;
  interruptOn?: CreateDeepAgentParams["interruptOn"];
  permissions?: CreateDeepAgentParams["permissions"];
  permissionOptions?: CreateDefaultPermissionsOptions;
  subagents?: CreateDeepAgentParams["subagents"];
  subagentOverrides?: CreateDefaultSubagentsOptions;
  clarificationOptions?: Partial<ClarificationConfig>;
};

export type CreateBasicAgentOptions = CreateScaffoldedAgentOptions;

export function createBaselineAgent(options: CreateBaselineAgentOptions = {}): DeepAgent {
  const {
    guardrails,
    langSmith,
    middleware,
    model,
    openRouter,
    promptLoader = DEFAULT_PROMPT_LOADER,
    systemPrompt,
    ...agentOptions
  } = options;

  configureLangSmithTracing(langSmith);
  const chatModel = createChatModel({ model, openRouter });

  return createDeepAgent({
    name: DEFAULT_AGENT_NAME,
    systemPrompt: systemPrompt ?? promptLoader.getBaselinePrompt(),
    ...agentOptions,
    middleware: composeGuardrailMiddleware(guardrails, chatModel, middleware),
    model: chatModel,
  });
}

export function createScaffoldedAgent(options: CreateScaffoldedAgentOptions = {}): DeepAgent {
  const {
    backend,
    backendOptions,
    guardrails,
    interruptOn,
    langSmith,
    memory,
    middleware,
    model,
    openRouter,
    permissions,
    permissionOptions,
    promptLoader = DEFAULT_PROMPT_LOADER,
    subagents,
    subagentOverrides,
    systemPrompt,
    clarificationOptions,
    ...agentOptions
  } = options;

  const blueprint = createSupervisorBlueprint({
    ...subagentOverrides,
    clarification: clarificationOptions,
    permissions: permissionOptions,
    promptLoader,
  } satisfies CreateSupervisorBlueprintOptions);

  configureLangSmithTracing(langSmith);
  const chatModel = createChatModel({ model, openRouter });

  return createDeepAgent({
    name: DEFAULT_AGENT_NAME,
    systemPrompt: systemPrompt ?? promptLoader.getSupervisorPrompt(blueprint.clarification.config),
    backend: backend ?? createDefaultCompositeBackend(backendOptions),
    interruptOn: interruptOn ?? blueprint.interruptOn,
    memory: memory ?? [...blueprint.memoryFilePaths],
    permissions: permissions ?? blueprint.permissions,
    subagents: subagents ?? blueprint.subagents,
    ...agentOptions,
    middleware: composeGuardrailMiddleware(guardrails, chatModel, middleware),
    model: chatModel,
  });
}

export function createBasicAgent(options: CreateScaffoldedAgentOptions = {}): DeepAgent {
  return createScaffoldedAgent(options);
}

export { createSupervisorBlueprint, DEFAULT_SYSTEM_PROMPT };

function composeGuardrailMiddleware(
  guardrails: false | CreateDefaultGuardrailsOptions | undefined,
  taskScopeModel: StructuredTaskScopeModel,
  middleware: CreateDeepAgentParams["middleware"],
): DeepAgentMiddleware[] {
  const defaultGuardrails =
    guardrails === false ? [] : createDefaultGuardrails({ ...guardrails, taskScopeModel });

  return [...defaultGuardrails, ...(middleware ?? [])];
}
