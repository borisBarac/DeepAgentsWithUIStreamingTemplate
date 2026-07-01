import { createClarificationConfig } from "./config.ts";
import { createClarificationState } from "./state.ts";
import type { ClarificationGateDecision, ResolveClarificationGateOptions } from "./types.ts";

function executionDecision(
  options: ResolveClarificationGateOptions,
  state: ClarificationGateDecision["state"],
  config: ClarificationGateDecision["config"],
): ClarificationGateDecision {
  if (!options.generativeUiEnabled) {
    return {
      phase: "execution",
      shouldDelegateToClarifier: false,
      canPlan: true,
      canDelegate: true,
      canFinalize: true,
      state,
      config,
    };
  }

  if (!options.productBatchGenerated) {
    return {
      phase: "product_generation",
      shouldDelegateToClarifier: false,
      requiredSubagent: "product-generator",
      canPlan: false,
      canDelegate: true,
      canFinalize: false,
      state,
      config,
    };
  }

  if (options.reviewStatus === "approved") {
    return {
      phase: "execution",
      shouldDelegateToClarifier: false,
      canPlan: true,
      canDelegate: true,
      canFinalize: true,
      state,
      config,
    };
  }

  if (options.reviewStatus === "blocked") {
    return {
      phase: "blocked",
      shouldDelegateToClarifier: false,
      canPlan: false,
      canDelegate: false,
      canFinalize: false,
      reviewFeedback: options.reviewFeedback,
      state,
      config,
    };
  }

  if (options.reviewStatus === "changes_required") {
    return {
      phase: "product_generation",
      shouldDelegateToClarifier: false,
      requiredSubagent: "product-generator",
      canPlan: false,
      canDelegate: true,
      canFinalize: false,
      reviewFeedback: options.reviewFeedback,
      state,
      config,
    };
  }

  return {
    phase: "review",
    shouldDelegateToClarifier: false,
    requiredSubagent: "review-agent",
    canPlan: false,
    canDelegate: true,
    canFinalize: false,
    state,
    config,
  };
}

export function resolveClarificationGate(
  options: ResolveClarificationGateOptions,
): ClarificationGateDecision {
  const config = createClarificationConfig(options.config);

  if (!config.enabled || config.mode !== "mandatory-preflight") {
    return {
      phase: "execution",
      shouldDelegateToClarifier: false,
      canPlan: true,
      canDelegate: true,
      canFinalize: true,
      state: options.state ?? null,
      config,
    };
  }

  const state =
    options.state ??
    (options.isNewRequest ? createClarificationState(options.request, config) : null);

  if (!state) {
    return {
      phase: "clarification",
      shouldDelegateToClarifier: true,
      requiredSubagent: "clarifier",
      canPlan: false,
      canDelegate: false,
      canFinalize: false,
      state: createClarificationState(options.request, config),
      config,
    };
  }

  if (state.status === "ready_to_proceed") {
    return executionDecision(options, state, config);
  }

  if (state.status === "blocked") {
    return {
      phase: "blocked",
      shouldDelegateToClarifier: false,
      canPlan: false,
      canDelegate: false,
      canFinalize: false,
      state,
      config,
    };
  }

  return {
    phase: "clarification",
    shouldDelegateToClarifier: true,
    requiredSubagent: "clarifier",
    canPlan: false,
    canDelegate: false,
    canFinalize: false,
    state,
    config,
  };
}
