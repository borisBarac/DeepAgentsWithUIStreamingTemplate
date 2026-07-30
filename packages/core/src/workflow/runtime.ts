import { HumanMessage, type ToolMessage } from "@langchain/core/messages";
import type { Command } from "@langchain/langgraph";
import { createMiddleware, type ToolCallHandler, type ToolCallRequest } from "langchain";

import {
  applyClarificationResult,
  type ClarificationState,
  createClarificationState,
} from "../clarification/index.ts";
import type { UiUpdate } from "../generative-ui/index.ts";
import { reviewReportSchema } from "../review/index.ts";
import { createWorkflowState, reduceWorkflowState, resolveWorkflowDecision } from "./reducer.ts";
import {
  CONTROLLER_FEEDBACK_ENVELOPE,
  DELEGATION_SUBAGENT_ARG,
  DELEGATION_TOOL_NAME,
  feedbackMessage,
  feedbackTail,
  hasToolCalls,
  latestHumanText,
  looksLikeJsonSubagentReply,
  productContext,
  proseWorkflowPacket,
  threadId,
  toolMessage,
  WorkflowRuntimeError,
} from "./runtime-helpers.ts";
import {
  clarificationSubmissionSchema,
  productBatchSchema,
  workflowCompleteExecutionTool,
  workflowOutcomeSchema,
  workflowSubmitClarificationTool,
  workflowSubmitProductsTool,
  workflowSubmitReviewTool,
} from "./runtime-tools.ts";
import { InMemoryWorkflowStateStore, type WorkflowStateStore } from "./store.ts";
import type { WorkflowControllerOptions, WorkflowState } from "./types.ts";

export { WorkflowRuntimeError } from "./runtime-helpers.ts";
export {
  productBatchSchema,
  productItemSchema,
  workflowCompleteExecutionTool,
  workflowSubmitClarificationTool,
  workflowSubmitProductsTool,
  workflowSubmitReviewTool,
} from "./runtime-tools.ts";

function createPersistence(store: WorkflowStateStore) {
  const persist = async (runtime: unknown, state: WorkflowState): Promise<void> => {
    await store.save(threadId(runtime), state);
  };

  const archive = async (runtime: unknown): Promise<void> => {
    await store.archive(threadId(runtime));
  };

  const load = async (runtime: unknown): Promise<WorkflowState | undefined> =>
    store.load(threadId(runtime));

  return { persist, archive, load };
}

type PersistFn = (runtime: unknown, state: WorkflowState) => Promise<void>;
type LoadFn = (runtime: unknown) => Promise<WorkflowState | undefined>;
type ArchiveFn = (runtime: unknown) => Promise<void>;
type ToolResult = ReturnType<typeof toolMessage>;
type TickControllerBudgetFn = ReturnType<typeof createTickControllerBudget>;

function bootstrapWorkflowState(
  messages: unknown[],
  latestUserMessage: string,
  productGenerationEnabled: boolean,
): WorkflowState {
  return createWorkflowState(
    latestUserMessage,
    productContext(messages, latestUserMessage, productGenerationEnabled),
  );
}

async function runBeforeAgent(
  messages: unknown[],
  runtime: unknown,
  deps: { load: LoadFn; archive: ArchiveFn; persist: PersistFn; productGenerationEnabled: boolean },
) {
  const latestUserMessage = latestHumanText(messages);
  let state = await deps.load(runtime);
  if (!state) {
    state = bootstrapWorkflowState(messages, latestUserMessage, deps.productGenerationEnabled);
  } else if (state.phase === "waiting_for_user") {
    state = reduceWorkflowState(state, { type: "user_replied" });
  } else if (state.phase === "delivery_ready" || state.phase === "error") {
    await deps.archive(runtime);
    state = bootstrapWorkflowState(messages, latestUserMessage, deps.productGenerationEnabled);
  }
  await deps.persist(runtime, state);
}

async function runAfterModel(
  messages: unknown[],
  runtime: unknown,
  deps: { load: LoadFn; persist: PersistFn; retryLimit: number },
): Promise<{ messages: HumanMessage[]; jumpTo: "model" } | undefined> {
  const state = await deps.load(runtime);
  if (!state || state.phase === "waiting_for_user" || state.phase === "delivery_ready") return;
  const last = messages.at(-1);
  if (hasToolCalls(last)) return;
  const next = reduceWorkflowState(state, {
    type: "controller_feedback",
    message: feedbackMessage(state),
    retryLimit: deps.retryLimit,
  });
  await deps.persist(runtime, next);
  if (next.phase === "error" && next.terminalError)
    throw new WorkflowRuntimeError(next.terminalError);
  return { messages: [new HumanMessage(feedbackMessage(next))], jumpTo: "model" as const };
}

function rejectInvalidPhase(request: ToolCallRequest, state: WorkflowState): ToolResult {
  return toolMessage(request, {
    error: "invalid_workflow_phase",
    phase: state.phase,
    requiredAction: resolveWorkflowDecision(state).requiredAction,
  });
}

function rejectMissingSubagent(
  request: ToolCallRequest,
  state: WorkflowState,
  requiredSubagent: string,
): ToolResult {
  return toolMessage(request, {
    error: "required_subagent_not_completed",
    requiredSubagent,
    phase: state.phase,
  });
}

async function handleClarificationSubmission(
  request: ToolCallRequest,
  state: WorkflowState,
  options: WorkflowControllerOptions,
  persist: PersistFn,
): Promise<ToolResult> {
  if (state.phase !== "clarification") return rejectInvalidPhase(request, state);
  if (state.completedSubagent !== "clarifier")
    return rejectMissingSubagent(request, state, "clarifier");
  const args = request.toolCall.args as Record<string, unknown>;
  const parsed = clarificationSubmissionSchema.safeParse(args);
  if (!parsed.success) {
    return toolMessage(request, {
      error: "invalid_clarification_result",
      issues: parsed.error.issues,
    });
  }
  const prior =
    state.clarification ??
    createClarificationState(state.originalRequest, {
      maxRounds: options.maxClarificationRounds,
      questionsPerRound: options.questionsPerRound,
    });
  const roundCount =
    parsed.data.status === "ready_to_proceed"
      ? prior.roundCount
      : Math.min(prior.roundCount + 1, options.maxClarificationRounds);
  const authoritative = {
    ...parsed.data,
    requestKind: "products" as const,
    roundCount,
    maxRounds: options.maxClarificationRounds,
  };
  let clarification: ClarificationState;
  try {
    clarification = applyClarificationResult(prior, authoritative);
  } catch (error) {
    return toolMessage(request, {
      error: "invalid_clarification_result",
      issues: [{ message: error instanceof Error ? error.message : String(error) }],
    });
  }
  const normalized = {
    ...authoritative,
    status: clarification.status,
    readyToProceed: clarification.readyToProceed,
    questions: clarification.openQuestions,
    missingInformation: clarification.missingInformation,
  };
  const normalizedState = {
    ...clarification,
    status: normalized.status,
    readyToProceed: normalized.readyToProceed,
    openQuestions: normalized.questions,
  };
  const next = reduceWorkflowState(state, {
    type: "clarification_completed",
    result: normalized,
    state: normalizedState,
  });
  await persist(request.runtime, next);
  return toolMessage(request, {
    status: "accepted",
    nextPhase: next.phase,
    result: normalized,
  });
}

async function handleExecutionCompletion(
  request: ToolCallRequest,
  state: WorkflowState,
  persist: PersistFn,
): Promise<ToolResult> {
  if (state.phase !== "execution" && state.phase !== "revision") {
    return rejectInvalidPhase(request, state);
  }
  const args = request.toolCall.args as Record<string, unknown>;
  const parsed = workflowOutcomeSchema.safeParse(args);
  if (!parsed.success)
    return toolMessage(request, {
      error: "invalid_outcome_packet",
      issues: parsed.error.issues,
    });
  const next = reduceWorkflowState(state, {
    type: "execution_completed",
    outcome: parsed.data,
  });
  await persist(request.runtime, next);
  return toolMessage(request, { status: "accepted", nextPhase: next.phase });
}

async function handleProductSubmission(
  request: ToolCallRequest,
  state: WorkflowState,
  persist: PersistFn,
): Promise<ToolResult> {
  if (state.phase !== "product_generation") return rejectInvalidPhase(request, state);
  if (state.completedSubagent !== "product-generator") {
    return rejectMissingSubagent(request, state, "product-generator");
  }
  const args = request.toolCall.args as Record<string, unknown>;
  const parsed = productBatchSchema.safeParse(args);
  if (!parsed.success) {
    return toolMessage(request, {
      error: "invalid_product_batch",
      issues: parsed.error.issues,
    });
  }
  const ids = parsed.data.products.map((product) => product.id);
  const oldIds = new Set(state.existingProducts?.products.map((product) => product.id) ?? []);
  const expectedRoot = state.existingProducts?.gridRoot ?? "products";
  if (
    parsed.data.mode !== state.productMode ||
    parsed.data.gridRoot !== expectedRoot ||
    parsed.data.products.length !== state.targetProductCount ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => oldIds.has(id))
  ) {
    return toolMessage(request, {
      error: "invalid_product_batch",
      expected: {
        mode: state.productMode,
        gridRoot: expectedRoot,
        productCount: state.targetProductCount,
        uniqueIds: true,
        replacementIds: "new",
      },
    });
  }
  const next = reduceWorkflowState(state, { type: "products_submitted", batch: parsed.data });
  await persist(request.runtime, next);
  return toolMessage(request, { status: "accepted", nextPhase: next.phase });
}

async function handleReviewSubmission(
  request: ToolCallRequest,
  state: WorkflowState,
  options: WorkflowControllerOptions,
  persist: PersistFn,
): Promise<ToolResult> {
  if (state.phase !== "review") return rejectInvalidPhase(request, state);
  if (state.completedSubagent !== "review-agent") {
    return rejectMissingSubagent(request, state, "review-agent");
  }
  const args = request.toolCall.args as Record<string, unknown>;
  const parsed = reviewReportSchema.safeParse(args);
  if (!parsed.success) {
    return toolMessage(request, {
      error: "invalid_review_report",
      issues: parsed.error.issues,
    });
  }
  const next = reduceWorkflowState(state, {
    type: "review_completed",
    report: parsed.data,
    maxReviewCycles: options.maxReviewCycles,
  });
  await persist(request.runtime, next);
  return toolMessage(request, { status: "accepted", nextPhase: next.phase });
}

async function routeSubagentDelegation<S extends Record<string, unknown>, C>(
  request: ToolCallRequest<S, C>,
  state: WorkflowState,
  subagent: string,
  handler: ToolCallHandler<S, C>,
  deps: { persist: PersistFn; tickControllerBudget: TickControllerBudgetFn },
): Promise<ToolMessage | Command> {
  const expected = resolveWorkflowDecision(state).requiredSubagent;
  if (subagent && expected && subagent !== expected) {
    const feedbackText = buildControllerFeedback(
      state,
      "wrong_subagent",
      `Delegated to ${subagent} but this phase requires ${expected}. Re-delegate to the required subagent. Do not call any workflow_submit_* tool on its behalf.`,
    );
    return deps.tickControllerBudget(state, feedbackText, request);
  }
  if (subagent !== expected) return handler(request);

  // The required subagent already completed this phase; the contract now is
  // to call the matching workflow_submit_* tool. Re-delegating instead would
  // loop forever: subagent_completed is idempotent and the happy path does
  // not tick controllerRetryCount, so run.output would never settle. Route
  // the failure through tickControllerBudget so retryLimit bounds it.
  if (state.completedSubagent === expected) {
    const feedbackText = buildControllerFeedback(
      state,
      "subagent_already_completed",
      `The ${expected} subagent has already returned its result this phase. Do not re-delegate — call the corresponding workflow_submit_* tool with its output, or finalize if the phase is terminal.`,
    );
    return deps.tickControllerBudget(state, feedbackText, request, expected);
  }

  const args = request.toolCall.args as Record<string, unknown>;
  const packet = proseWorkflowPacket(state);
  const response = await handler({
    ...request,
    toolCall: {
      ...request.toolCall,
      args: { ...args, description: `${String(args.description ?? "")}${packet}` },
    },
  });
  const replyContent = (response as { content?: unknown } | undefined)?.content;
  if (looksLikeJsonSubagentReply(replyContent, expected)) {
    const feedbackText = buildControllerFeedback(
      state,
      "subagent_returned_json",
      `The ${expected} subagent returned JSON. Its contract is prose with labeled fields (no JSON, no code fences). Re-delegate and instruct it to return prose only. Do not forward JSON into any workflow_submit_* tool.`,
    );
    return deps.tickControllerBudget(state, feedbackText, request, expected);
  }
  await deps.persist(
    request.runtime,
    reduceWorkflowState(state, {
      type: "subagent_completed",
      subagent: expected,
    }),
  );
  return response;
}

function createHasWorkflowState(store: WorkflowStateStore) {
  return async (id: string): Promise<boolean> => (await store.load(id)) !== undefined;
}

function createDrainPendingUi(store: WorkflowStateStore) {
  /**
   * Drain pending deterministic UI (products / clarification questions)
   * for a session and clear the fields via the `ui_drained` reducer event.
   * Returns an empty array when no UI is pending. Called by the agent
   * adapter after each work run so the interaction-stream receives the
   * updates as a structured response without a second LLM call.
   */
  return async (id: string): Promise<UiUpdate[]> => {
    const state = await store.load(id);
    if (!state) return [];
    const updates: UiUpdate[] = [];
    if (state.pendingProductUi) updates.push(state.pendingProductUi);
    if (state.pendingClarificationUi) updates.push(...state.pendingClarificationUi);
    if (updates.length === 0) return [];
    const next = reduceWorkflowState(state, { type: "ui_drained" });
    await store.save(id, next);
    return updates;
  };
}

function createTickControllerBudget({
  persist,
  retryLimit,
}: {
  persist: PersistFn;
  retryLimit: number;
}) {
  return async <S extends Record<string, unknown>, C>(
    state: WorkflowState,
    feedbackText: string,
    request: ToolCallRequest<S, C>,
    expectedSubagent?: string,
  ): Promise<ToolMessage> => {
    const next = reduceWorkflowState(state, {
      type: "controller_feedback",
      message: feedbackText,
      retryLimit,
    });
    await persist(request.runtime, next);
    if (next.phase === "error" && next.terminalError)
      throw new WorkflowRuntimeError(next.terminalError, expectedSubagent);
    return toolMessage(request, feedbackText);
  };
}

function buildControllerFeedback(state: WorkflowState, errorKey: string, message: string) {
  const decision = resolveWorkflowDecision(state);
  return [
    CONTROLLER_FEEDBACK_ENVELOPE,
    `phase=${decision.phase}`,
    `requiredAction=${decision.requiredAction}`,
    decision.requiredSubagent ? `requiredSubagent=${decision.requiredSubagent}` : undefined,
    `error=${errorKey}`,
    message,
    feedbackTail(decision.canFinalize),
  ]
    .filter(Boolean)
    .join("\n");
}

export function createWorkflowControllerMiddleware(options: WorkflowControllerOptions) {
  const store = options.workflowStateStore ?? new InMemoryWorkflowStateStore();
  const retryLimit = options.controllerRetryLimit ?? 4;
  const { persist, archive, load } = createPersistence(store);
  const tickControllerBudget = createTickControllerBudget({ persist, retryLimit });

  const middleware = createMiddleware({
    name: "workflowController",
    tools: [
      workflowSubmitClarificationTool,
      workflowCompleteExecutionTool,
      workflowSubmitReviewTool,
      workflowSubmitProductsTool,
    ],
    beforeAgent: async (agentState, runtime) => {
      await runBeforeAgent(agentState.messages, runtime, {
        load,
        archive,
        persist,
        productGenerationEnabled: options.productGenerationEnabled === true,
      });
    },
    wrapModelCall: async (request, handler) => {
      const state = await load(request.runtime);
      if (!state) return handler(request);
      return handler({
        ...request,
        systemPrompt: `${request.systemPrompt}\n\n${feedbackMessage(state)}`,
      });
    },
    afterModel: {
      canJumpTo: ["model"],
      hook: async (agentState, runtime) =>
        runAfterModel(agentState.messages, runtime, { load, persist, retryLimit }),
    },
    wrapToolCall: async (request, handler) => {
      const state = await load(request.runtime);
      if (!state) return handler(request);
      const name = request.toolCall.name;
      if (name === "workflow_submit_clarification")
        return handleClarificationSubmission(request, state, options, persist);
      if (name === "workflow_complete_execution")
        return handleExecutionCompletion(request, state, persist);
      if (name === "workflow_submit_products")
        return handleProductSubmission(request, state, persist);
      if (name === "workflow_submit_review")
        return handleReviewSubmission(request, state, options, persist);

      const args = request.toolCall.args as Record<string, unknown>;
      const subagent =
        name === DELEGATION_TOOL_NAME ? String(args[DELEGATION_SUBAGENT_ARG] ?? "") : "";
      return routeSubagentDelegation(request, state, subagent, handler, {
        persist,
        tickControllerBudget,
      });
    },
  });

  return Object.assign(middleware, {
    getWorkflowState: (id: string) => store.load(id),
    hasWorkflowState: createHasWorkflowState(store),
    drainPendingUi: createDrainPendingUi(store),
  });
}
