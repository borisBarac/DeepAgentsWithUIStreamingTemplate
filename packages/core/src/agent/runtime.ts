import { type CreateDeepAgentParams, createDeepAgent, type DeepAgent } from "deepagents";
import type { CreateGuardrailDecisionOptions } from "../guardrails/index.ts";
import { createGuardrailDecision } from "../guardrails/index.ts";
import type { ModelRole, ModelRuntime } from "../models/index.ts";
import type { LangSmithTracingOptions } from "../observability/index.ts";
import { configureLangSmithTracing } from "../observability/index.ts";
import type { RuntimeScaffold } from "../scaffold/index.ts";
import { DEFAULT_AGENT_NAME } from "./constants.ts";

type AgentPassthroughOptions = Pick<
  CreateDeepAgentParams,
  "checkpointer" | "responseFormat" | "skills" | "streamTransformers" | "tools"
> & {
  name?: string;
};

export type CreateAgentFromRuntimeScaffoldOptions = {
  factoryName: "createBaselineAgent" | "createScaffoldedAgent";
  scaffold: RuntimeScaffold;
  modelRuntime: ModelRuntime | undefined;
  guardrails?: false | CreateGuardrailDecisionOptions;
  langSmith?: LangSmithTracingOptions;
  middleware?: CreateDeepAgentParams["middleware"];
  store?: CreateDeepAgentParams["store"];
  agentOptions?: AgentPassthroughOptions;
};

export function createAgentFromRuntimeScaffold(
  options: CreateAgentFromRuntimeScaffoldOptions,
): DeepAgent {
  const {
    agentOptions = {},
    factoryName,
    guardrails,
    langSmith,
    middleware,
    modelRuntime,
    scaffold,
  } = options;

  if (!modelRuntime) {
    throw new Error(
      `${factoryName} requires a modelRuntime. Provide one via createModelRuntime(...).`,
    );
  }

  configureLangSmithTracing(langSmith);

  const guardrailDecision = createGuardrailDecision(
    guardrails === false
      ? { enabled: false, middleware }
      : {
          ...guardrails,
          safetyModel:
            modelRuntime.getModelForGuardrails?.() ?? modelRuntime.getModelForCategory("fast"),
          taskScopeModel:
            modelRuntime.getModelForGuardrails?.() ?? modelRuntime.getModelForCategory("fast"),
          middleware,
        },
  );

  return createDeepAgent({
    name: DEFAULT_AGENT_NAME,
    ...agentOptions,
    store: options.store,
    systemPrompt: scaffold.systemPrompt,
    backend: scaffold.backend,
    interruptOn: scaffold.interruptOn,
    memory: scaffold.memory,
    permissions: scaffold.permissions,
    subagents: scaffold.subagents,
    middleware: guardrailDecision.middleware,
    model: modelRuntime.getModelForRole(getModelRoleForScaffold(scaffold)),
  });
}

function getModelRoleForScaffold(scaffold: RuntimeScaffold): ModelRole {
  switch (scaffold.architecture) {
    case "baseline":
      return "baseline";
    case "supervisor-specialists":
      return "supervisor";
  }
}
