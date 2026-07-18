import type { WorkflowDecision, WorkflowEvent, WorkflowPhase, WorkflowState } from "./types.ts";

export function createWorkflowState(originalRequest: string): WorkflowState {
  return {
    phase: "clarification",
    originalRequest,
    clarification: null,
    assumptions: [],
    reviewHistory: [],
    revisionCount: 0,
    controllerRetryCount: 0,
    caveated: false,
  };
}

function invalid(state: WorkflowState, event: WorkflowEvent): WorkflowState {
  return {
    ...state,
    phase: "error",
    terminalError: {
      code: "invalid_transition",
      message: `Cannot apply ${event.type} while workflow is ${state.phase}.`,
      phase: state.phase,
    },
  };
}

export function reduceWorkflowState(state: WorkflowState, event: WorkflowEvent): WorkflowState {
  switch (event.type) {
    case "subagent_completed":
      return { ...state, completedSubagent: event.subagent };
    case "clarification_completed":
      if (state.phase !== "clarification") return invalid(state, event);
      return {
        ...state,
        clarification: event.state,
        clarificationResult: event.result,
        phase: event.result.readyToProceed ? "execution" : "waiting_for_user",
        controllerRetryCount: 0,
        completedSubagent: undefined,
      };
    case "user_replied":
      return state.phase === "waiting_for_user"
        ? { ...state, phase: "clarification", controllerRetryCount: 0 }
        : invalid(state, event);
    case "execution_completed":
      if (state.phase !== "execution" && state.phase !== "revision") return invalid(state, event);
      return {
        ...state,
        outcome: event.outcome,
        assumptions: event.outcome.assumptions,
        phase: "review",
        controllerRetryCount: 0,
        completedSubagent: undefined,
      };
    case "review_completed": {
      if (state.phase !== "review") return invalid(state, event);
      const reviewHistory = [...state.reviewHistory, event.report];
      if (event.report.status === "approved") {
        return {
          ...state,
          reviewHistory,
          phase: "delivery_ready",
          controllerRetryCount: 0,
          completedSubagent: undefined,
        };
      }
      if (reviewHistory.length >= event.maxRevisions) {
        return {
          ...state,
          reviewHistory,
          phase: "delivery_ready",
          caveated: true,
          controllerRetryCount: 0,
          completedSubagent: undefined,
        };
      }
      return {
        ...state,
        reviewHistory,
        revisionCount: state.revisionCount + 1,
        phase: "revision",
        lastFeedback: event.report.requiredChanges.join("\n") || event.report.finalRecommendation,
        controllerRetryCount: 0,
        completedSubagent: undefined,
      };
    }
    case "controller_feedback": {
      const count = state.controllerRetryCount + 1;
      if (count > event.retryLimit) {
        return {
          ...state,
          phase: "error",
          controllerRetryCount: count,
          terminalError: {
            code: "controller_retry_exhausted",
            message: event.message,
            phase: state.phase,
          },
        };
      }
      return { ...state, controllerRetryCount: count, lastFeedback: event.message };
    }
  }
}

const actions: Record<WorkflowPhase, WorkflowDecision> = {
  clarification: {
    phase: "clarification",
    requiredAction: "clarify",
    requiredSubagent: "clarifier",
    canFinalize: false,
  },
  waiting_for_user: {
    phase: "waiting_for_user",
    requiredAction: "wait_for_user",
    canFinalize: true,
  },
  execution: { phase: "execution", requiredAction: "execute", canFinalize: false },
  review: {
    phase: "review",
    requiredAction: "review",
    requiredSubagent: "review-agent",
    canFinalize: false,
  },
  revision: { phase: "revision", requiredAction: "revise", canFinalize: false },
  delivery_ready: { phase: "delivery_ready", requiredAction: "deliver", canFinalize: true },
  error: { phase: "error", requiredAction: "fail", canFinalize: false },
};

export function resolveWorkflowDecision(state: WorkflowState): WorkflowDecision {
  const decision = actions[state.phase];
  return state.lastFeedback ? { ...decision, feedback: state.lastFeedback } : decision;
}
