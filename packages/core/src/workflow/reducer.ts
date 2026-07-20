import type { UiSpecUpdate } from "../generative-ui/index.ts";
import {
  clarificationResultToQuestionUpdates,
  productBatchToUiUpdate,
} from "../generative-ui/index.ts";
import type { ProductBatch } from "./products.ts";
import type { WorkflowDecision, WorkflowEvent, WorkflowPhase, WorkflowState } from "./types.ts";

/**
 * Builds the deterministic UI payload for delivery after review approves the
 * current product batch (or the review budget exhausts with a caveat). UI is
 * intentionally produced only at this point: nothing is rendered before review
 * approval, and revision must repeat generation and review before any UI is
 * emitted. Returns `undefined` when no batch has been generated (e.g.
 * product generation is disabled), which keeps the message-only path intact
 * for runtimes that opt out of the product flow.
 */
function approvedProductUi(state: WorkflowState): UiSpecUpdate | undefined {
  if (!state.productGenerationEnabled) return undefined;
  const batch = currentProductBatch(state);
  return batch ? productBatchToUiUpdate(batch) : undefined;
}

function currentProductBatch(state: WorkflowState): ProductBatch | undefined {
  if (state.generatedProducts) return state.generatedProducts;
  if (state.existingProducts) {
    return {
      mode: state.productMode,
      gridRoot: state.existingProducts.gridRoot,
      products: state.existingProducts.products,
    };
  }
  return undefined;
}

export function createWorkflowState(
  originalRequest: string,
  productState: Pick<
    WorkflowState,
    "existingProducts" | "productMode" | "targetProductCount" | "productGenerationEnabled"
  > = {
    existingProducts: null,
    productMode: "create",
    targetProductCount: 3,
    productGenerationEnabled: false,
  },
): WorkflowState {
  return {
    phase: "clarification",
    originalRequest,
    clarification: null,
    assumptions: [],
    reviewHistory: [],
    revisionCount: 0,
    controllerRetryCount: 0,
    caveated: false,
    ...productState,
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
        lastFeedback: undefined,
        pendingClarificationUi: event.result.readyToProceed
          ? undefined
          : clarificationResultToQuestionUpdates(event.result),
        pendingProductUi: undefined,
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
        phase: state.productGenerationEnabled ? "product_generation" : "review",
        controllerRetryCount: 0,
        completedSubagent: undefined,
        lastFeedback: undefined,
      };
    case "products_submitted":
      if (state.phase !== "product_generation") return invalid(state, event);
      return {
        ...state,
        generatedProducts: event.batch,
        phase: "review",
        controllerRetryCount: 0,
        completedSubagent: undefined,
        lastFeedback: undefined,
        pendingClarificationUi: undefined,
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
          lastFeedback: undefined,
          pendingProductUi: approvedProductUi(state),
        };
      }
      if (reviewHistory.length >= event.maxReviewCycles) {
        return {
          ...state,
          reviewHistory,
          phase: "delivery_ready",
          caveated: true,
          controllerRetryCount: 0,
          completedSubagent: undefined,
          lastFeedback: undefined,
          pendingProductUi: approvedProductUi(state),
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
    case "ui_drained":
      return { ...state, pendingProductUi: undefined, pendingClarificationUi: undefined };
  }
}

const EXECUTION_ENTRY_DIRECTIVE =
  "Clarification complete. Begin execution now: delegate to `researcher` or `analyst` only when product generation needs external facts or deeper analysis, or submit `workflow_complete_execution` directly to advance to product generation. Do NOT call the clarifier.";

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
  execution: {
    phase: "execution",
    requiredAction: "execute",
    canFinalize: false,
    feedback: EXECUTION_ENTRY_DIRECTIVE,
  },
  product_generation: {
    phase: "product_generation",
    requiredAction: "generate_products",
    requiredSubagent: "product-generator",
    canFinalize: false,
  },
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
