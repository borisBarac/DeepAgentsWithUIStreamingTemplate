import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import type { BaseStore } from "@langchain/langgraph";
import { createMiddleware, type ToolCallRequest, tool } from "langchain";
import { z } from "zod";

import {
  applyClarificationResult,
  type ClarificationState,
  clarificationResultSchema,
  createClarificationState,
} from "../clarification/index.ts";
import type { UiUpdate } from "../generative-ui/index.ts";
import { reviewReportSchema } from "../review/index.ts";
import { type ProductBatch, productContext } from "./products.ts";
import { createWorkflowState, reduceWorkflowState, resolveWorkflowDecision } from "./reducer.ts";
import type {
  WorkflowControllerOptions,
  WorkflowError,
  WorkflowOutcomePacket,
  WorkflowState,
} from "./types.ts";
import { WORKFLOW_PHASES } from "./types.ts";

const workflowOutcomeSchema = z.object({
  candidateFinalResponse: z.string().min(1),
  deliverables: z.array(z.string()),
  validationEvidence: z.array(z.string()),
  assumptions: z.array(z.string()),
});

export const productItemSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  imagePrompt: z.string().trim().min(1).optional(),
});

export const productBatchSchema = z.object({
  mode: z.enum(["create", "update"]),
  gridRoot: z.string().trim().min(1),
  products: z.array(productItemSchema).min(1),
});

export const workflowCompleteExecutionTool = tool(
  async (input: WorkflowOutcomePacket) => JSON.stringify(input),
  {
    name: "workflow_complete_execution",
    description: "Submit the complete execution outcome packet. Required before review.",
    schema: workflowOutcomeSchema,
  },
);

const clarificationSubmissionSchema = clarificationResultSchema.omit({
  roundCount: true,
  maxRounds: true,
});

export const workflowSubmitClarificationTool = tool(async (input) => JSON.stringify(input), {
  name: "workflow_submit_clarification",
  description:
    "Submit the clarifier result after delegating to the clarifier. The host supplies round counters.",
  schema: clarificationSubmissionSchema,
});

export const workflowSubmitReviewTool = tool(async (input) => JSON.stringify(input), {
  name: "workflow_submit_review",
  description: "Submit the review report after delegating to review-agent.",
  schema: reviewReportSchema,
});

export const workflowSubmitProductsTool = tool(
  async (input: ProductBatch) => JSON.stringify(input),
  {
    name: "workflow_submit_products",
    description: "Submit the full replacement product batch after delegating to product-generator.",
    schema: productBatchSchema,
  },
);

/** Thrown when the workflow controller reaches a terminal error state. */
export class WorkflowRuntimeError extends Error {
  constructor(
    readonly terminalError: WorkflowError,
    readonly subagent?: string,
  ) {
    super(USER_FACING_WORKFLOW_ERRORS[terminalError.code] ?? terminalError.message);
    this.name = "WorkflowRuntimeError";
  }
}

const USER_FACING_WORKFLOW_ERRORS: Record<WorkflowError["code"], string> = {
  controller_retry_exhausted:
    "The agent could not complete this task after multiple attempts. Please rephrase the request or try again.",
  invalid_transition:
    "The workflow entered an unexpected state. Please rephrase the request or try again.",
  malformed_output_limit_exceeded:
    "The agent could not produce a valid response. Please try again.",
};

function looksLikeWorkflowState(value: unknown): value is WorkflowState {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.originalRequest === "string" &&
    typeof record.phase === "string" &&
    WORKFLOW_PHASES.has(record.phase as WorkflowState["phase"])
  );
}

function threadId(runtime: unknown): string {
  return String(
    (runtime as { configurable?: { thread_id?: unknown } })?.configurable?.thread_id ??
      "__default__",
  );
}

function latestHumanText(messages: unknown[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message instanceof HumanMessage) {
      return typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content);
    }
  }
  return "";
}

function proseWorkflowPacket(state: WorkflowState): string {
  if (!state.outcome) return "";
  const lines: string[] = [
    "",
    "",
    "Authoritative workflow packet (read-only context; respond in prose per your contract):",
  ];
  lines.push("REQUEST_KIND: products");
  if (state.outcome.candidateFinalResponse) {
    lines.push(`EXECUTION_OUTCOME: ${state.outcome.candidateFinalResponse}`);
  }
  if (state.outcome.deliverables.length > 0) {
    lines.push("DELIVERABLES:");
    for (const deliverable of state.outcome.deliverables) lines.push(`- ${deliverable}`);
  }
  lines.push(`PRODUCT_MODE: ${state.productMode}`);
  lines.push(`GRID_ROOT: ${state.existingProducts?.gridRoot ?? "products"}`);
  lines.push(`TARGET_PRODUCT_COUNT: ${state.targetProductCount}`);
  const existing = state.existingProducts?.products ?? [];
  if (existing.length > 0) {
    lines.push("EXISTING_PRODUCTS:");
    for (const product of existing) {
      lines.push(`- ID: ${product.id}`);
      lines.push(`  TITLE: ${product.title}`);
    }
  } else {
    lines.push("EXISTING_PRODUCTS: none");
  }
  const generated = state.generatedProducts?.products ?? [];
  if (generated.length > 0) {
    lines.push("GENERATED_PRODUCTS:");
    for (const product of generated) {
      lines.push(`- ID: ${product.id}`);
      lines.push(`  TITLE: ${product.title}`);
    }
  }
  lines.push(`REVIEW_FEEDBACK: ${state.lastFeedback ?? "none"}`);
  return lines.join("\n");
}

const PROSE_CONTRACT_SUBAGENTS = new Set(["clarifier", "product-generator", "review-agent"]);

function looksLikeJsonSubagentReply(content: unknown, subagent: string): boolean {
  if (!PROSE_CONTRACT_SUBAGENTS.has(subagent)) return false;
  const text = typeof content === "string" ? content.trimStart() : "";
  if (!text) return false;
  if (text.startsWith("{") || text.startsWith("[")) return true;
  return /```(?:json|jsonc)?\s*[\r\n]*\s*[{[]/.test(text);
}

function hasToolCalls(message: unknown): boolean {
  return (
    message instanceof AIMessage &&
    Array.isArray(message.tool_calls) &&
    message.tool_calls.length > 0
  );
}

const CONTROLLER_FEEDBACK_ENVELOPE = "WORKFLOW_CONTROLLER_FEEDBACK";
const DELEGATION_TOOL_NAME = "task";
const DELEGATION_SUBAGENT_ARG = "subagent_type";

function feedbackTail(canFinalize: boolean): string {
  return canFinalize
    ? "Proceed with the required action now."
    : "Do the required action now. Do not narrate or finalize early.";
}

function feedbackMessage(state: WorkflowState): string {
  const decision = resolveWorkflowDecision(state);
  const feedback =
    decision.feedback && !decision.feedback.startsWith(CONTROLLER_FEEDBACK_ENVELOPE)
      ? decision.feedback
      : undefined;
  return [
    CONTROLLER_FEEDBACK_ENVELOPE,
    `phase=${decision.phase}`,
    `requiredAction=${decision.requiredAction}`,
    decision.requiredSubagent ? `requiredSubagent=${decision.requiredSubagent}` : undefined,
    feedback ? `reviewFeedback=${feedback}` : undefined,
    feedbackTail(decision.canFinalize),
  ]
    .filter(Boolean)
    .join("\n");
}

function toolMessage(request: ToolCallRequest, content: unknown): ToolMessage {
  return new ToolMessage({
    content: typeof content === "string" ? content : JSON.stringify(content),
    tool_call_id: request.toolCall.id ?? "workflow-controller",
    name: request.toolCall.name,
  });
}

export function createWorkflowControllerMiddleware(options: WorkflowControllerOptions) {
  const states = new Map<string, WorkflowState>();
  const retryLimit = options.controllerRetryLimit ?? 4;

  const persist = async (runtime: unknown, state: WorkflowState) => {
    states.set(threadId(runtime), state);
    try {
      const store = (runtime as { store?: BaseStore })?.store;
      await store?.put(["agent-workflow", threadId(runtime)], "active", state);
    } catch {
      // Best-effort persistence; the in-memory cache remains authoritative.
    }
  };

  const archive = async (runtime: unknown, state: WorkflowState) => {
    try {
      const store = (runtime as { store?: BaseStore })?.store;
      if (!store) return;
      await store.put(["agent-workflow", threadId(runtime), "archive"], crypto.randomUUID(), state);
      await store.delete(["agent-workflow", threadId(runtime)], "active");
    } catch {
      // Best-effort archiving.
    }
  };

  const load = async (runtime: unknown): Promise<WorkflowState | undefined> => {
    const id = threadId(runtime);
    const cached = states.get(id);
    if (cached) return cached;
    try {
      const store = (runtime as { store?: BaseStore })?.store;
      const item = await store?.get(["agent-workflow", id], "active");
      const value = item?.value;
      if (!looksLikeWorkflowState(value)) return undefined;
      states.set(id, value);
      return value;
    } catch {
      return undefined;
    }
  };

  const tickControllerBudget = async (
    state: WorkflowState,
    feedbackText: string,
    request: ToolCallRequest,
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

  const middleware = createMiddleware({
    name: "workflowController",
    tools: [
      workflowSubmitClarificationTool,
      workflowCompleteExecutionTool,
      workflowSubmitReviewTool,
      workflowSubmitProductsTool,
    ],
    beforeAgent: async (agentState, runtime) => {
      const latestUserMessage = latestHumanText(agentState.messages);
      // Active phases resume the in-flight workflow; only delivery_ready/error archive-and-restart,
      // and waiting_for_user advances via user_replied. The latest user message feeds
      // product-context extraction only on fresh starts.
      let state = await load(runtime);
      if (!state) {
        state = createWorkflowState(
          latestUserMessage,
          productContext(
            agentState.messages,
            latestUserMessage,
            options.productGenerationEnabled === true,
          ),
        );
      } else if (state.phase === "waiting_for_user") {
        state = reduceWorkflowState(state, { type: "user_replied" });
      } else if (state.phase === "delivery_ready" || state.phase === "error") {
        await archive(runtime, state);
        state = createWorkflowState(
          latestUserMessage,
          productContext(
            agentState.messages,
            latestUserMessage,
            options.productGenerationEnabled === true,
          ),
        );
      }
      await persist(runtime, state);
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
      hook: async (agentState, runtime) => {
        const state = await load(runtime);
        if (!state || state.phase === "waiting_for_user" || state.phase === "delivery_ready")
          return;
        const last = agentState.messages.at(-1);
        if (hasToolCalls(last)) return;
        const next = reduceWorkflowState(state, {
          type: "controller_feedback",
          message: feedbackMessage(state),
          retryLimit,
        });
        await persist(runtime, next);
        if (next.phase === "error" && next.terminalError)
          throw new WorkflowRuntimeError(next.terminalError);
        return { messages: [new HumanMessage(feedbackMessage(next))], jumpTo: "model" as const };
      },
    },
    wrapToolCall: async (request, handler) => {
      const state = await load(request.runtime);
      if (!state) return handler(request);
      const args = request.toolCall.args as Record<string, unknown>;
      const subagent =
        request.toolCall.name === DELEGATION_TOOL_NAME
          ? String(args[DELEGATION_SUBAGENT_ARG] ?? "")
          : "";

      const rejectPhase = () =>
        toolMessage(request, {
          error: "invalid_workflow_phase",
          phase: state.phase,
          requiredAction: resolveWorkflowDecision(state).requiredAction,
        });
      const rejectMissingSubagent = (requiredSubagent: string) =>
        toolMessage(request, {
          error: "required_subagent_not_completed",
          requiredSubagent,
          phase: state.phase,
        });

      if (request.toolCall.name === "workflow_submit_clarification") {
        if (state.phase !== "clarification") return rejectPhase();
        if (state.completedSubagent !== "clarifier") return rejectMissingSubagent("clarifier");
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

      if (request.toolCall.name === "workflow_complete_execution") {
        if (state.phase !== "execution" && state.phase !== "revision") {
          return rejectPhase();
        }
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

      if (request.toolCall.name === "workflow_submit_products") {
        if (state.phase !== "product_generation") return rejectPhase();
        if (state.completedSubagent !== "product-generator") {
          return rejectMissingSubagent("product-generator");
        }
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

      if (request.toolCall.name === "workflow_submit_review") {
        if (state.phase !== "review") return rejectPhase();
        if (state.completedSubagent !== "review-agent") {
          return rejectMissingSubagent("review-agent");
        }
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

      const expected = resolveWorkflowDecision(state).requiredSubagent;
      if (subagent && expected && subagent !== expected) {
        const decision = resolveWorkflowDecision(state);
        const feedbackText = [
          CONTROLLER_FEEDBACK_ENVELOPE,
          `phase=${decision.phase}`,
          `requiredAction=${decision.requiredAction}`,
          decision.requiredSubagent ? `requiredSubagent=${decision.requiredSubagent}` : undefined,
          "error=wrong_subagent",
          `Delegated to ${subagent} but this phase requires ${expected}. Re-delegate to the required subagent. Do not call any workflow_submit_* tool on its behalf.`,
          feedbackTail(decision.canFinalize),
        ]
          .filter(Boolean)
          .join("\n");
        return tickControllerBudget(state, feedbackText, request);
      }
      if (subagent !== expected) return handler(request);

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
        const decision = resolveWorkflowDecision(state);
        const feedbackText = [
          CONTROLLER_FEEDBACK_ENVELOPE,
          `phase=${decision.phase}`,
          `requiredAction=${decision.requiredAction}`,
          decision.requiredSubagent ? `requiredSubagent=${decision.requiredSubagent}` : undefined,
          "error=subagent_returned_json",
          `The ${expected} subagent returned JSON. Its contract is prose with labeled fields (no JSON, no code fences). Re-delegate and instruct it to return prose only. Do not forward JSON into any workflow_submit_* tool.`,
          feedbackTail(decision.canFinalize),
        ]
          .filter(Boolean)
          .join("\n");
        return tickControllerBudget(state, feedbackText, request, expected);
      }
      await persist(
        request.runtime,
        reduceWorkflowState(state, {
          type: "subagent_completed",
          subagent: expected,
        }),
      );
      return response;
    },
  });

  return Object.assign(middleware, {
    getWorkflowState: (id: string) => states.get(id),
    /**
     * Drain pending deterministic UI (products / clarification questions)
     * for a session and clear the fields via the `ui_drained` reducer event.
     * Returns an empty array when no UI is pending. Called by the agent
     * adapter after each work run so the interaction-stream receives the
     * updates as a structured response without a second LLM call.
     */
    drainPendingUi: (id: string): UiUpdate[] => {
      const state = states.get(id);
      if (!state) return [];
      const updates: UiUpdate[] = [];
      if (state.pendingProductUi) updates.push(state.pendingProductUi);
      if (state.pendingClarificationUi) updates.push(...state.pendingClarificationUi);
      if (updates.length === 0) return [];
      const next = reduceWorkflowState(state, { type: "ui_drained" });
      states.set(id, next);
      void persist({ runtime: { configurable: { thread_id: id } } } as never, next);
      return updates;
    },
  });
}
