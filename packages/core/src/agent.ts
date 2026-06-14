import { type CreateDeepAgentParams, createDeepAgent, type DeepAgent } from "deepagents";

import { type CreateChatModelOptions, createChatModel } from "./models";
import { configureLangSmithTracing, type LangSmithTracingOptions } from "./observability";

export const DEFAULT_AGENT_NAME = "deep-agent-template";

export const DEFAULT_SYSTEM_PROMPT =
  "You are a helpful general-purpose deep agent. Use the built-in planning, filesystem, and task delegation tools when they are useful.";

type DeepAgentScaffoldOptions = Pick<
  CreateDeepAgentParams,
  | "backend"
  | "checkpointer"
  | "interruptOn"
  | "memory"
  | "middleware"
  | "permissions"
  | "skills"
  | "store"
  | "subagents"
  | "tools"
>;

export type CreateBasicAgentOptions = DeepAgentScaffoldOptions &
  CreateChatModelOptions & {
    name?: string;
    systemPrompt?: string;
    langSmith?: LangSmithTracingOptions;
  };

export function createBasicAgent(options: CreateBasicAgentOptions = {}): DeepAgent {
  const { langSmith, model, openRouter, ...agentOptions } = options;

  configureLangSmithTracing(langSmith);

  return createDeepAgent({
    name: DEFAULT_AGENT_NAME,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    ...agentOptions,
    model: createChatModel({ model, openRouter }),
  });
}
