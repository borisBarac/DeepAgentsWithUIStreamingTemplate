import { type CreateDeepAgentParams, createDeepAgent, type DeepAgent } from "deepagents";

import { type CreateChatModelOptions, createChatModel } from "./models";
import { configureLangSmithTracing, type LangSmithTracingOptions } from "./observability";
import {
  DEFAULT_BASELINE_SYSTEM_PROMPT,
  DEFAULT_SUPERVISOR_SYSTEM_PROMPT,
  DEFAULT_SYSTEM_PROMPT,
} from "./prompts";
import {
  type CreateCompositeBackendOptions,
  type CreateDefaultPermissionsOptions,
  type CreateDefaultSubagentsOptions,
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
    name?: string;
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
};

export type CreateBasicAgentOptions = CreateScaffoldedAgentOptions;

export function createBaselineAgent(options: CreateBaselineAgentOptions = {}): DeepAgent {
  const { langSmith, model, openRouter, ...agentOptions } = options;

  configureLangSmithTracing(langSmith);

  return createDeepAgent({
    name: DEFAULT_AGENT_NAME,
    systemPrompt: DEFAULT_BASELINE_SYSTEM_PROMPT,
    ...agentOptions,
    model: createChatModel({ model, openRouter }),
  });
}

export function createScaffoldedAgent(options: CreateScaffoldedAgentOptions = {}): DeepAgent {
  const {
    backend,
    backendOptions,
    interruptOn,
    langSmith,
    memory,
    model,
    openRouter,
    permissions,
    permissionOptions,
    subagents,
    subagentOverrides,
    ...agentOptions
  } = options;

  const blueprint = createSupervisorBlueprint({
    ...subagentOverrides,
    permissions: permissionOptions,
  });

  configureLangSmithTracing(langSmith);

  return createDeepAgent({
    name: DEFAULT_AGENT_NAME,
    systemPrompt: DEFAULT_SUPERVISOR_SYSTEM_PROMPT,
    backend: backend ?? createDefaultCompositeBackend(backendOptions),
    interruptOn: interruptOn ?? blueprint.interruptOn,
    memory: memory ?? [...blueprint.memoryFilePaths],
    permissions: permissions ?? blueprint.permissions,
    subagents: subagents ?? blueprint.subagents,
    ...agentOptions,
    model: createChatModel({ model, openRouter }),
  });
}

export function createBasicAgent(options: CreateScaffoldedAgentOptions = {}): DeepAgent {
  return createScaffoldedAgent(options);
}

export { createSupervisorBlueprint, DEFAULT_SYSTEM_PROMPT };
