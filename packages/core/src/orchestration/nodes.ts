import { resolveClarificationGate } from "../clarification/index.ts";

import { selectWorkRoute } from "./routing.ts";
import type { NodeContext } from "./runtime.ts";
import { runStageAgent } from "./runtime.ts";
import type { OrchestratedGraphState } from "./state.ts";
import type { OrchestratedDeepAgentRole } from "./types.ts";

type StageNodeConfig = {
  role: OrchestratedDeepAgentRole;
  instruction: string;
  required: boolean;
  successRoute: import("./types.ts").OrchestratedDeepAgentRoute;
  assignOutput(update: Partial<OrchestratedGraphState>, output: string): void;
};

export function createIntakeNode(ctx: NodeContext) {
  return (state: OrchestratedGraphState): Partial<OrchestratedGraphState> => {
    const gate = resolveClarificationGate({
      isNewRequest: true,
      request: state.task,
      state: state.clarification ?? null,
      config: ctx.clarification,
    });

    if (gate.state) {
      if (gate.phase === "clarification") {
        return { clarification: gate.state, next: "clarify" };
      }
      if (gate.phase === "blocked") {
        return { clarification: gate.state, next: "blocked" };
      }
    }

    return {
      clarification: gate.state ?? state.clarification,
      next: selectWorkRoute(state.task, ctx.routing),
    };
  };
}

export function createGatekeeperNode(ctx: NodeContext) {
  return async (state: OrchestratedGraphState): Promise<Partial<OrchestratedGraphState>> => {
    if (!ctx.gatekeeper) {
      return { next: "final" };
    }

    const result = await ctx.gatekeeper.check(state.task);
    if (result.decision.inScope) {
      return { gatekeeperDecision: result.decision, next: "final" };
    }

    return {
      gatekeeperDecision: result.decision,
      finalAnswer: result.blockedMessage,
      next: "blocked",
    };
  };
}

export function createClarifyNode(ctx: NodeContext) {
  return (state: OrchestratedGraphState): Partial<OrchestratedGraphState> => {
    const gate = resolveClarificationGate({
      isNewRequest: false,
      request: state.task,
      state: state.clarification ?? null,
      config: ctx.clarification,
    });
    const clarification = gate.state ?? state.clarification;

    if (clarification?.status === "ready_to_proceed") {
      return { clarification, next: selectWorkRoute(state.task, ctx.routing) };
    }

    return { clarification, next: "clarify" };
  };
}

function createStageNode(ctx: NodeContext, config: StageNodeConfig) {
  return async (state: OrchestratedGraphState): Promise<Partial<OrchestratedGraphState>> => {
    const result = await runStageAgent(state, ctx, config.role, config.instruction, {
      required: config.required,
      successRoute: config.successRoute,
    });
    const update: Partial<OrchestratedGraphState> = { next: result.next };
    if (result.output !== undefined) {
      config.assignOutput(update, result.output);
    }
    if (result.errors) {
      update.errors = result.errors;
    }
    return update;
  };
}

export function createResearchNode(ctx: NodeContext) {
  return createStageNode(ctx, {
    role: "researcher",
    instruction: "Produce concise findings with source notes and unresolved questions.",
    required: false,
    successRoute: "final",
    assignOutput: (update, output) => {
      update.researchResult = output;
    },
  });
}

export function createCodeNode(ctx: NodeContext) {
  return createStageNode(ctx, {
    role: "coder",
    instruction: "Produce implementation guidance, a changed-file plan, and risks.",
    required: false,
    successRoute: "final",
    assignOutput: (update, output) => {
      update.codeResult = output;
    },
  });
}
