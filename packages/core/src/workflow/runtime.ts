import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { type BaseStore, Command } from "@langchain/langgraph";
import { createMiddleware, type ToolCallRequest, tool } from "langchain";
import { z } from "zod";

import {
  applyClarificationResult,
  clarificationResultSchema,
  createClarificationState,
} from "../clarification/index.ts";
import { productCardBatchSchema } from "../generative-ui/index.ts";
import { reviewReportSchema } from "../review/index.ts";
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

export const workflowCompleteExecutionTool = tool(
  async (input: WorkflowOutcomePacket) => JSON.stringify(input),
  {
    name: "workflow_complete_execution",
    description:
      "Submit the complete execution outcome packet. Required before products and review.",
    schema: workflowOutcomeSchema,
  },
);

/** Consecutive malformed subagent outputs before the controller gives up and fails. */
const MALFORMED_OUTPUT_LIMIT = 3;

/** Thrown when the workflow controller reaches a terminal error state. */
export class WorkflowRuntimeError extends Error {
  constructor(
    readonly terminalError: WorkflowError,
    readonly subagent?: string,
  ) {
    super(`[${terminalError.code}] ${terminalError.message}`);
    this.name = "WorkflowRuntimeError";
  }
}

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

function contentOf(value: unknown): unknown {
  if (value instanceof ToolMessage) return value.content;
  if (value instanceof Command) {
    const messages = (value.update as { messages?: unknown[] } | undefined)?.messages;
    const last = messages?.at(-1);
    return last instanceof ToolMessage ? last.content : undefined;
  }
  return undefined;
}

function jsonOf(value: unknown): unknown {
  const content = contentOf(value);
  if (typeof content !== "string") return undefined;
  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
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

function hasToolCalls(message: unknown): boolean {
  return (
    message instanceof AIMessage &&
    Array.isArray(message.tool_calls) &&
    message.tool_calls.length > 0
  );
}

function feedbackMessage(state: WorkflowState): string {
  const decision = resolveWorkflowDecision(state);
  return [
    "WORKFLOW_CONTROLLER_FEEDBACK",
    `phase=${decision.phase}`,
    `requiredAction=${decision.requiredAction}`,
    decision.requiredSubagent ? `requiredSubagent=${decision.requiredSubagent}` : undefined,
    decision.feedback ? `reviewFeedback=${decision.feedback}` : undefined,
    "Do the required action now. Do not narrate or finalize early.",
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
  const malformedCounts = new Map<string, number>();
  const retryLimit = options.controllerRetryLimit ?? 2;

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

  const malformed = async (
    id: string,
    state: WorkflowState,
    subagent: string,
    payload: unknown,
    request: ToolCallRequest,
  ): Promise<ToolMessage> => {
    const count = (malformedCounts.get(id) ?? 0) + 1;
    if (count > MALFORMED_OUTPUT_LIMIT) {
      malformedCounts.delete(id);
      const terminalError: WorkflowError = {
        code: "malformed_output_limit_exceeded",
        message: `Subagent "${subagent}" returned malformed output ${MALFORMED_OUTPUT_LIMIT} consecutive times.`,
        phase: state.phase,
      };
      await persist(request.runtime, { ...state, phase: "error", terminalError });
      throw new WorkflowRuntimeError(terminalError, subagent);
    }
    malformedCounts.set(id, count);
    return toolMessage(request, payload);
  };

  const middleware = createMiddleware({
    name: "workflowController",
    tools: [workflowCompleteExecutionTool],
    beforeAgent: async (agentState, runtime) => {
      let state = await load(runtime);
      if (!state) {
        state = createWorkflowState(latestHumanText(agentState.messages));
      } else if (state.phase === "waiting_for_user") {
        state = reduceWorkflowState(state, { type: "user_replied" });
      } else if (state.phase === "delivery_ready" || state.phase === "error") {
        await archive(runtime, state);
        state = createWorkflowState(latestHumanText(agentState.messages));
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
      const id = threadId(request.runtime);
      const state = states.get(id) ?? (await load(request.runtime));
      if (!state) return handler(request);
      const args = request.toolCall.args as Record<string, unknown>;
      const subagent = request.toolCall.name === "task" ? String(args.subagent_type ?? "") : "";

      if (request.toolCall.name === "workflow_complete_execution") {
        if (state.phase !== "execution" && state.phase !== "revision") {
          return toolMessage(request, feedbackMessage(state));
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
          generativeUiEnabled: options.generativeUiEnabled,
        });
        await persist(request.runtime, next);
        return toolMessage(request, { status: "accepted", nextPhase: next.phase });
      }

      const expected = resolveWorkflowDecision(state).requiredSubagent;
      if (subagent && expected && subagent !== expected) {
        return toolMessage(request, feedbackMessage(state));
      }
      if (!subagent || subagent !== expected) return handler(request);

      const packet = state.outcome
        ? `\n\nAuthoritative workflow outcome packet:\n${JSON.stringify({ outcome: state.outcome, productBatch: state.productBatch, reviewFeedback: state.lastFeedback })}`
        : "";
      const response = await handler({
        ...request,
        toolCall: {
          ...request.toolCall,
          args: { ...args, description: `${String(args.description ?? "")}${packet}` },
        },
      });
      if (subagent === "clarifier") {
        const parsed = clarificationResultSchema.safeParse(jsonOf(response));
        if (!parsed.success)
          return malformed(
            id,
            state,
            "clarifier",
            { error: "invalid_clarification_result", issues: parsed.error.issues },
            request,
          );
        malformedCounts.delete(id);
        const prior =
          state.clarification ??
          createClarificationState(state.originalRequest, {
            maxRounds: options.maxClarificationRounds,
            questionsPerRound: options.questionsPerRound,
          });
        const roundCount = Math.min(prior.roundCount + 1, options.maxClarificationRounds);
        const authoritative = {
          ...parsed.data,
          roundCount,
          maxRounds: options.maxClarificationRounds,
        };
        const clarification = applyClarificationResult(prior, authoritative);
        const normalized =
          roundCount >= options.maxClarificationRounds && !clarification.readyToProceed
            ? {
                ...authoritative,
                status: "ready_to_proceed" as const,
                readyToProceed: true,
                questions: [],
                missingInformation: clarification.missingInformation,
              }
            : {
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
        await persist(
          request.runtime,
          reduceWorkflowState(state, {
            type: "clarification_completed",
            result: normalized,
            state: normalizedState,
          }),
        );
        return toolMessage(request, normalized);
      }
      if (subagent === "product-generator") {
        const parsed = productCardBatchSchema.safeParse(jsonOf(response));
        if (!parsed.success)
          return malformed(
            id,
            state,
            "product-generator",
            {
              error: "invalid_product_batch",
              issues: parsed.error.issues,
            },
            request,
          );
        malformedCounts.delete(id);
        await persist(
          request.runtime,
          reduceWorkflowState(state, { type: "product_generated", batch: parsed.data }),
        );
        return response;
      }
      const parsed = reviewReportSchema.safeParse(jsonOf(response));
      if (!parsed.success)
        return malformed(
          id,
          state,
          "review-agent",
          {
            error: "invalid_review_report",
            issues: parsed.error.issues,
          },
          request,
        );
      malformedCounts.delete(id);
      await persist(
        request.runtime,
        reduceWorkflowState(state, {
          type: "review_completed",
          report: parsed.data,
          maxRevisions: options.maxRevisions,
        }),
      );
      return response;
    },
  });

  return Object.assign(middleware, {
    getWorkflowState: (id: string) => states.get(id),
  });
}
