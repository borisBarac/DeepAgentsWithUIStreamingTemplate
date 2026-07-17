import { type CreateDeepAgentParams, createDeepAgent, type DeepAgent } from "deepagents";
import { providerStrategy } from "langchain";
import { modelUiOutputSchema } from "../generative-ui/index.ts";
import type { CreateGuardrailDecisionOptions } from "../guardrails/index.ts";
import { createGuardrailDecision } from "../guardrails/index.ts";
import type { ModelRuntime } from "../models/index.ts";
import type { LangSmithTracingOptions } from "../observability/index.ts";
import { configureLangSmithTracing } from "../observability/index.ts";
import type { RuntimeScaffold } from "../scaffold/index.ts";
import { createStructuredJsonMiddleware } from "../scaffold/index.ts";
import { DEFAULT_AGENT_NAME } from "./constants.ts";

type AgentPassthroughOptions = Pick<
  CreateDeepAgentParams,
  "checkpointer" | "responseFormat" | "skills" | "streamTransformers" | "tools"
> & {
  name?: string;
};

export type CreateAgentFromRuntimeScaffoldOptions = {
  factoryName: "createScaffoldedAgent";
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
  const { responseFormat: callerResponseFormat, ...remainingAgentOptions } = agentOptions;

  if (!modelRuntime) {
    throw new Error(
      `${factoryName} requires a modelRuntime. Provide one via createModelRuntime(...).`,
    );
  }

  configureLangSmithTracing(langSmith);

  if (scaffold.generativeUi && callerResponseFormat !== undefined) {
    throw new Error(
      `${factoryName} cannot combine generativeUi with a custom responseFormat. Remove responseFormat so the generative UI JSON object contract can be enforced.`,
    );
  }

  const generativeUiResponseFormat = scaffold.generativeUi
    ? providerStrategy(modelUiOutputSchema)
    : undefined;
  const generativeUiMiddleware = generativeUiResponseFormat
    ? [
        createStructuredJsonMiddleware(generativeUiResponseFormat.schema, {
          retryOnParsingError: false,
        }),
      ]
    : [];

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
    ...remainingAgentOptions,
    store: options.store,
    systemPrompt: scaffold.systemPrompt,
    backend: scaffold.backend,
    interruptOn: scaffold.interruptOn,
    memory: scaffold.memory,
    permissions: scaffold.permissions,
    subagents: scaffold.subagents,
    middleware: [...guardrailDecision.middleware, ...generativeUiMiddleware],
    model: modelRuntime.getModelForRole("supervisor"),
    responseFormat: generativeUiResponseFormat ?? callerResponseFormat,
  });
}
