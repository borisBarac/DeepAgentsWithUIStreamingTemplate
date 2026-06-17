import { type CreateDeepAgentParams, createDeepAgent, type DeepAgent } from "deepagents";

import { type CreateGuardrailDecisionOptions, createGuardrailDecision } from "../guardrails/index.ts";
import { type CreateChatModelOptions, createChatModel } from "../models/index.ts";
import { configureLangSmithTracing, type LangSmithTracingOptions } from "../observability/index.ts";
import { DEFAULT_PROMPT_LOADER, DEFAULT_SYSTEM_PROMPT, type PromptLoader } from "../prompts/index.ts";
import { type CreateRuntimeScaffoldOptions, createRuntimeScaffold } from "../scaffold/index.ts";

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
    guardrails?: false | CreateGuardrailDecisionOptions;
    name?: string;
    promptLoader?: PromptLoader;
    systemPrompt?: string;
    langSmith?: LangSmithTracingOptions;
  };

export type CreateScaffoldedAgentOptions = Omit<
  CreateBaselineAgentOptions,
  "backend" | "interruptOn" | "permissions" | "subagents"
> &
  Omit<
    CreateRuntimeScaffoldOptions,
    "promptLoader" | "researcher" | "analyst" | "critic" | "clarifier"
  > & {
    subagentOverrides?: Pick<
      CreateRuntimeScaffoldOptions,
      "researcher" | "analyst" | "critic" | "clarifier"
    >;
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
  const guardrailDecision = createGuardrailDecision(
    guardrails === false
      ? { enabled: false, middleware }
      : { ...guardrails, taskScopeModel: chatModel, middleware },
  );

  return createDeepAgent({
    name: DEFAULT_AGENT_NAME,
    systemPrompt: systemPrompt ?? promptLoader.getBaselinePrompt(),
    ...agentOptions,
    middleware: guardrailDecision.middleware,
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

  const scaffold = createRuntimeScaffold({
    backend,
    backendOptions,
    clarificationOptions,
    interruptOn,
    memory,
    permissions,
    permissionOptions,
    promptLoader,
    subagents,
    systemPrompt,
    ...subagentOverrides,
  });

  configureLangSmithTracing(langSmith);
  const chatModel = createChatModel({ model, openRouter });
  const guardrailDecision = createGuardrailDecision(
    guardrails === false
      ? { enabled: false, middleware }
      : { ...guardrails, taskScopeModel: chatModel, middleware },
  );

  return createDeepAgent({
    name: DEFAULT_AGENT_NAME,
    systemPrompt: scaffold.systemPrompt,
    backend: scaffold.backend,
    interruptOn: scaffold.interruptOn,
    memory: scaffold.memory,
    permissions: scaffold.permissions,
    subagents: scaffold.subagents,
    ...agentOptions,
    middleware: guardrailDecision.middleware,
    model: chatModel,
  });
}

export function createBasicAgent(options: CreateScaffoldedAgentOptions = {}): DeepAgent {
  return createScaffoldedAgent(options);
}

export { DEFAULT_SYSTEM_PROMPT };
