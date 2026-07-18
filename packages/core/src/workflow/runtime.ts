import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import type { BaseStore } from "@langchain/langgraph";
import { createMiddleware, type ToolCallRequest, tool } from "langchain";
import { z } from "zod";

import {
  applyClarificationResult,
  type ClarificationResult,
  type ClarificationState,
  clarificationResultSchema,
  classifyClarificationTriage,
  createClarificationState,
  PROCEED_TRIAGE_DECISION,
  TRIAGE_SKIP_REASON,
} from "../clarification/index.ts";
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
  const retryLimit = options.controllerRetryLimit ?? 2;
  const triageEnabled = options.triageEnabled !== false && Boolean(options.triageClassifier);

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

  /**
   * Runs the triage classifier against the latest user message and, on a `skip`
   * decision, synthesizes a `clarification_completed` event so the reducer
   * transitions straight to `execution`. Safe-defaults to `proceed` on any
   * classifier exception so a flaky fast-model never blocks the run.
   *
   * Memoized via `state.lastTriageMessage` so the same user message is not
   * re-classified on subsequent `beforeAgent` invocations within a turn.
   */
  const runTriageIfNeeded = async (
    state: WorkflowState,
    latestUserMessage: string,
  ): Promise<WorkflowState> => {
    if (!triageEnabled || !options.triageClassifier) return state;
    if (state.phase !== "clarification") return state;
    if (!latestUserMessage || state.lastTriageMessage === latestUserMessage) return state;

    let decision = PROCEED_TRIAGE_DECISION;
    try {
      decision = await classifyClarificationTriage(
        latestUserMessage,
        options.triageClassifier,
        options.promptLoader,
      );
    } catch {
      // Safe default: any classifier failure (parse error, network, etc.)
      // falls through to the normal clarify phase. Logged via state only.
    }

    const memoed: WorkflowState = {
      ...state,
      lastTriageMessage: latestUserMessage,
      lastTriageDecision: decision,
    };

    if (decision.decision !== "skip") return memoed;

    const clarificationState: ClarificationState = {
      originalRequest: state.originalRequest,
      missingInformation: [],
      answeredInformation: [],
      openQuestions: [],
      status: "ready_to_proceed",
      readyToProceed: true,
      roundCount: 0,
      maxRounds: options.maxClarificationRounds,
      questionsPerRound: options.questionsPerRound,
    };

    const synthetic: ClarificationResult = {
      status: "ready_to_proceed",
      readyToProceed: true,
      questions: [],
      missingInformation: [],
      answeredInformation: [],
      reasoningSummary: `Triaged as execution-ready: ${decision.reason}`,
      roundCount: 0,
      maxRounds: options.maxClarificationRounds,
      skipReason: TRIAGE_SKIP_REASON,
    };

    return reduceWorkflowState(memoed, {
      type: "clarification_completed",
      result: synthetic,
      state: clarificationState,
    });
  };

  const middleware = createMiddleware({
    name: "workflowController",
    tools: [
      workflowSubmitClarificationTool,
      workflowCompleteExecutionTool,
      workflowSubmitReviewTool,
    ],
    beforeAgent: async (agentState, runtime) => {
      const latestUserMessage = latestHumanText(agentState.messages);
      let state = await load(runtime);
      if (!state) {
        state = createWorkflowState(latestUserMessage);
      } else if (state.phase === "waiting_for_user") {
        state = reduceWorkflowState(state, { type: "user_replied" });
      } else if (state.phase === "delivery_ready" || state.phase === "error") {
        await archive(runtime, state);
        state = createWorkflowState(latestUserMessage);
      }
      state = await runTriageIfNeeded(state, latestUserMessage);
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
      const state = states.get(threadId(request.runtime)) ?? (await load(request.runtime));
      if (!state) return handler(request);
      const args = request.toolCall.args as Record<string, unknown>;
      const subagent = request.toolCall.name === "task" ? String(args.subagent_type ?? "") : "";

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
        const roundCount = Math.min(prior.roundCount + 1, options.maxClarificationRounds);
        const authoritative = {
          ...parsed.data,
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
          maxRevisions: options.maxRevisions,
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
        ? `\n\nAuthoritative workflow outcome packet:\n${JSON.stringify({ outcome: state.outcome, reviewFeedback: state.lastFeedback })}`
        : "";
      const response = await handler({
        ...request,
        toolCall: {
          ...request.toolCall,
          args: { ...args, description: `${String(args.description ?? "")}${packet}` },
        },
      });
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
  });
}
