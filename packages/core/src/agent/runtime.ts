import {
  type CreateDeepAgentParams,
  createDeepAgent,
  type DeepAgent,
  type HarnessProfileOptions,
} from "deepagents";
import { type ModelUiOutput, normalizeModelUiOutput } from "../generative-ui/index.ts";
import type { CreateGuardrailDecisionOptions } from "../guardrails/index.ts";
import { createGuardrailDecision } from "../guardrails/index.ts";
import type { ModelRuntime } from "../models/index.ts";
import type { LangSmithTracingOptions } from "../observability/index.ts";
import { configureLangSmithTracing } from "../observability/index.ts";
import {
  createAgentHarnessProfile,
  ensureDefaultAgentProfileRegistered,
  registerAgentProfile,
} from "../profiles/index.ts";
import type { RuntimeScaffold } from "../scaffold/index.ts";
import { threadId } from "../workflow/runtime-helpers.ts";
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
  /**
   * Harness profile overrides. When omitted, the default profile from
   * {@link DEFAULT_AGENT_PROFILE} is registered once (idempotently) and
   * reused for every subsequent agent in this process. When provided, the
   * merged profile replaces the registration.
   */
  profile?: HarnessProfileOptions;
  agentOptions?: AgentPassthroughOptions;
};

/**
 * Agent wrapper that drains deterministic UI from the workflow controller
 * after each work run. Replaces the former two-phase presentation adapter:
 * there is no second LLM call. Product grids and clarification questions
 * are constructed by pure converters (productBatchToUiUpdate,
 * clarificationResultToQuestionUpdates) on the workflow reducer, stored on
 * WorkflowState as pendingProductUi / pendingClarificationUi, and drained
 * here so the interaction-stream sees them as a structured response.
 */
export type WorkflowUiAgent = DeepAgent & {
  invokeWork: DeepAgent["invoke"];
  streamWorkEvents: DeepAgent["streamEvents"];
};

type WorkflowController = {
  drainPendingUi(id: string): Promise<unknown[]>;
};

function findWorkflowController(
  middleware: CreateDeepAgentParams["middleware"] | undefined,
): WorkflowController | undefined {
  const candidate = middleware?.find(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      (entry as { name?: unknown }).name === "workflowController" &&
      typeof (entry as { drainPendingUi?: unknown }).drainPendingUi === "function",
  );
  return candidate as WorkflowController | undefined;
}

async function drainToStructuredResponse(
  controller: WorkflowController | undefined,
  sessionId: string,
): Promise<ModelUiOutput | undefined> {
  const updates = (await controller?.drainPendingUi(sessionId)) ?? [];
  if (updates.length === 0) return undefined;
  const candidate: ModelUiOutput = { version: 1, updates: updates as ModelUiOutput["updates"] };
  return normalizeModelUiOutput(candidate) ?? undefined;
}

function appendStructuredResponse(
  workResult: unknown,
  structuredResponse: ModelUiOutput | undefined,
): unknown {
  if (typeof workResult !== "object" || workResult === null) {
    return structuredResponse ? { structuredResponse } : workResult;
  }
  if (structuredResponse === undefined) return workResult;
  return { ...workResult, structuredResponse };
}

function createWorkflowUiAdapter(
  workAgent: DeepAgent,
  workflowController: WorkflowController | undefined,
): WorkflowUiAgent {
  const adapter = workAgent as WorkflowUiAgent;
  const invokeWork = workAgent.invoke.bind(workAgent) as DeepAgent["invoke"];
  const streamWorkEvents = workAgent.streamEvents.bind(workAgent) as DeepAgent["streamEvents"];
  adapter.invokeWork = invokeWork;
  adapter.streamWorkEvents = streamWorkEvents;
  adapter.invoke = (async (input: unknown, config?: unknown) => {
    const workResult = await invokeWork(input as never, config as never);
    const structuredResponse = await drainToStructuredResponse(
      workflowController,
      threadId(config),
    );
    return appendStructuredResponse(workResult, structuredResponse);
  }) as DeepAgent["invoke"];
  // v3 stream callers see a structuredResponse-wrapped output; v2 and other
  // property accesses pass through to the work run unchanged. LangGraph
  // stream's internal `this`-binding is preserved by binding forwarded
  // functions to the original target.
  adapter.streamEvents = (async (input: unknown, config: unknown) => {
    if ((config as { version?: unknown } | undefined)?.version !== "v3") {
      return streamWorkEvents(input as never, config as never);
    }
    const run = await streamWorkEvents(input as never, config as never);
    const output = Promise.resolve(run.output).then(async (workResult) => {
      const structuredResponse = await drainToStructuredResponse(
        workflowController,
        threadId(config),
      );
      return appendStructuredResponse(workResult, structuredResponse);
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
    profile,
    scaffold,
  } = options;
  const { responseFormat: callerResponseFormat, ...remainingAgentOptions } = agentOptions;

  if (!modelRuntime) {
    throw new Error(
      `${factoryName} requires a modelRuntime. Provide one via createModelRuntime(...).`,
    );
  }

  configureLangSmithTracing(langSmith);

  // Register the harness profile before createDeepAgent so its model-based
  // resolver picks it up. When the caller passes a profile, merge it on top
  // of DEFAULT_AGENT_PROFILE under the bare-openai key (additive: scalar
  // fields from the caller replace defaults, array fields accumulate).
  // Otherwise install the default profile once (idempotent across subsequent
  // agent builds in this process).
  if (profile) {
    registerAgentProfile(createAgentHarnessProfile(profile));
  } else {
    ensureDefaultAgentProfileRegistered();
  }

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

  // getWorkflowState(threadId) and drainPendingUi(threadId) are only reachable
  // from main-agent middleware. workflowController is installed by
  // createScaffoldedAgent on the main agent only (see scaffolded.ts) and does
  // not propagate to subagents. Subagents cannot read workflow state directly
  // — they receive the workflow packet via the `task` tool's description
  // argument instead.
  const workflowController = findWorkflowController(middleware);
  return createWorkflowUiAdapter(workAgent, workflowController);
}
