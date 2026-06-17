import { createClarificationConfig } from "./config.ts";
import { createClarificationState } from "./state.ts";
import type { ClarificationGateDecision, ResolveClarificationGateOptions } from "./types.ts";

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
      canPlan: false,
      canDelegate: false,
      state: createClarificationState(options.request, config),
      config,
    };
  }

  if (state.status === "ready_to_proceed") {
    return {
      phase: "execution",
      shouldDelegateToClarifier: false,
      canPlan: true,
      canDelegate: true,
      state,
      config,
    };
  }

  if (state.status === "blocked") {
    return {
      phase: "blocked",
      shouldDelegateToClarifier: false,
      canPlan: false,
      canDelegate: false,
      state,
      config,
    };
  }

  return {
    phase: "clarification",
    shouldDelegateToClarifier: true,
    canPlan: false,
    canDelegate: false,
    state,
    config,
  };
}
