import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { type CreateDeepAgentParams, createDeepAgent, type DeepAgent } from "deepagents";
import {
  composeGenerativeUiPrompt,
  type ModelUiOutput,
  modelUiOutputSchema,
} from "../generative-ui/index.ts";
import type { CreateGuardrailDecisionOptions } from "../guardrails/index.ts";
import { createGuardrailDecision } from "../guardrails/index.ts";
import type { ModelRuntime } from "../models/index.ts";
import type { LangSmithTracingOptions } from "../observability/index.ts";
import { configureLangSmithTracing } from "../observability/index.ts";
import { CORE_PROMPT_TEMPLATES } from "../prompts/index.ts";
import type { RuntimeScaffold } from "../scaffold/index.ts";
import type { WorkflowState } from "../workflow/index.ts";
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

export type PresentationRequest = {
  messages: unknown[];
  workResult: unknown;
  sessionId?: string;
  repairFeedback?: string;
};

export type TwoPhaseDeepAgent = DeepAgent & {
  invokeWork: DeepAgent["invoke"];
  streamWorkEvents: DeepAgent["streamEvents"];
  present(request: PresentationRequest): Promise<ModelUiOutput>;
};

type WorkflowController = {
  getWorkflowState(id: string): WorkflowState | undefined;
};

function textContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((part) =>
      typeof part === "string"
        ? part
        : typeof part === "object" && part !== null && "text" in part
          ? String(part.text)
          : "",
    )
    .filter(Boolean)
    .join("\n");
}

function candidateResponse(workResult: unknown): string {
  if (typeof workResult !== "object" || workResult === null || !("messages" in workResult)) {
    return "";
  }
  const messages = workResult.messages;
  if (!Array.isArray(messages)) return "";
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (typeof message === "object" && message !== null && "content" in message) {
      const text = textContent(message.content);
      if (text) return text;
    }
  }
  return "";
}

function presentationResult(
  workResult: unknown,
  structuredResponse?: ModelUiOutput,
  error?: unknown,
) {
  const base = typeof workResult === "object" && workResult !== null ? workResult : {};
  return {
    ...base,
    structuredResponse,
    workResult,
    ...(error ? { presentationError: error instanceof Error ? error.message : String(error) } : {}),
  };
}

function threadIdFromConfig(config: unknown): string {
  return String(
    (config as { configurable?: { thread_id?: unknown } } | undefined)?.configurable?.thread_id ??
      "__default__",
  );
}

function createTwoPhaseAdapter(
  workAgent: DeepAgent,
  presentationModel: ReturnType<
    NonNullable<CreateAgentFromRuntimeScaffoldOptions["modelRuntime"]>["getModelForRole"]
  >,
  presentationPrompt: string,
  workflowController: WorkflowController | undefined,
): TwoPhaseDeepAgent {
  const invokeWork = workAgent.invoke.bind(workAgent) as DeepAgent["invoke"];
  const streamWorkEvents = workAgent.streamEvents.bind(workAgent) as DeepAgent["streamEvents"];
  const structuredModel = presentationModel.withStructuredOutput(modelUiOutputSchema);

  const present = async (request: PresentationRequest): Promise<ModelUiOutput> => {
    const workflowState = workflowController?.getWorkflowState(request.sessionId ?? "__default__");
    const payload = {
      conversation: request.messages,
      workflowState,
      completedWork: workflowState?.outcome ?? null,
      candidateResponse: candidateResponse(request.workResult),
      repairFeedback: request.repairFeedback,
    };
    const value = await structuredModel.invoke([
      new SystemMessage(presentationPrompt),
      new HumanMessage(`Present this input as JSON:\n${JSON.stringify(payload)}`),
    ]);
    return modelUiOutputSchema.parse(value);
  };

  const adapter = workAgent as TwoPhaseDeepAgent;
  adapter.invokeWork = invokeWork;
  adapter.streamWorkEvents = streamWorkEvents;
  adapter.present = present;
  adapter.invoke = (async (input: unknown, config?: unknown) => {
    const workResult = await invokeWork(input as never, config as never);
    const request = {
      messages: (input as { messages?: unknown[] })?.messages ?? [],
      workResult,
      sessionId: threadIdFromConfig(config),
    };
    try {
      return presentationResult(workResult, await present(request));
    } catch (error) {
      return presentationResult(workResult, undefined, error);
    }
  }) as DeepAgent["invoke"];
  adapter.streamEvents = (async (input: unknown, config: unknown) => {
    if ((config as { version?: unknown } | undefined)?.version !== "v3") {
      return streamWorkEvents(input as never, config as never);
    }
    const run = await streamWorkEvents(input as never, config as never);
    const output = Promise.resolve(run.output).then(async (workResult) => {
      const request = {
        messages: (input as { messages?: unknown[] })?.messages ?? [],
        workResult,
        sessionId: threadIdFromConfig(config),
      };
      try {
        return presentationResult(workResult, await present(request));
      } catch (error) {
        return presentationResult(workResult, undefined, error);
      }
    });
    return new Proxy(run, {
      get(target, property) {
        if (property === "output") return output;
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }) as DeepAgent["streamEvents"];
  return adapter;
}

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

  const supervisorModel = modelRuntime.getModelForRole("supervisor");
  const workAgent = createDeepAgent({
    name: DEFAULT_AGENT_NAME,
    ...remainingAgentOptions,
    store: options.store,
    systemPrompt: scaffold.systemPrompt,
    backend: scaffold.backend,
    interruptOn: scaffold.interruptOn,
    memory: scaffold.memory,
    permissions: scaffold.permissions,
    subagents: scaffold.subagents,
    middleware: guardrailDecision.middleware,
    model: supervisorModel,
    responseFormat: callerResponseFormat,
  });

  if (!scaffold.generativeUi) return workAgent;

  const workflowController = middleware?.find(
    (entry): entry is typeof entry & WorkflowController =>
      entry.name === "workflowController" && "getWorkflowState" in entry,
  );
  const presentationPrompt = [
    CORE_PROMPT_TEMPLATES.presentation,
    composeGenerativeUiPrompt(scaffold.generativeUi.catalogPrompt),
  ].join("\n\n");
  return createTwoPhaseAdapter(workAgent, supervisorModel, presentationPrompt, workflowController);
}
