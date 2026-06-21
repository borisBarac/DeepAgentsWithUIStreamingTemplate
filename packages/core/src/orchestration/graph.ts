import { END, START, StateGraph } from "@langchain/langgraph";
import { createTaskScopeGatekeeper } from "../guardrails/index.ts";
import { configureLangSmithTracing } from "../observability/index.ts";
import { DEFAULT_PROMPT_LOADER } from "../prompts/index.ts";
import { createReviewConfig } from "../review/index.ts";
import { createFinalizerNode } from "./finalization.ts";
import {
  createClarifyNode,
  createCodeNode,
  createGatekeeperNode,
  createIntakeNode,
  createResearchNode,
} from "./nodes.ts";
import { routeToNextNode } from "./routing.ts";
import type { NodeContext } from "./runtime.ts";
import { OrchestratedStateAnnotation } from "./state.ts";
import type { CreateOrchestratedDeepAgentGraphOptions } from "./types.ts";

function createNodeContext(
  options: CreateOrchestratedDeepAgentGraphOptions,
  gatekeeper?: import("../guardrails/index.ts").TaskScopeGatekeeper,
): NodeContext {
  return {
    agents: options.agents ?? {},
    routing: options.routing ?? {},
    gatekeeper,
    clarification: options.clarification ?? {},
    guardrails: options.guardrails ?? false,
    review: createReviewConfig(options.review),
    promptLoader: options.promptLoader ?? DEFAULT_PROMPT_LOADER,
    modelRuntime: options.modelRuntime,
    defaults: {},
  };
}

function resolveGatekeeper(
  options: CreateOrchestratedDeepAgentGraphOptions,
): import("../guardrails/index.ts").TaskScopeGatekeeper | undefined {
  const gatekeeperOptions = options.gatekeeper === false ? undefined : options.gatekeeper;
  const gatekeeperConfigured = gatekeeperOptions !== undefined;
  const gatekeeperModel = !gatekeeperConfigured
    ? undefined
    : (gatekeeperOptions?.model ??
      (options.modelRuntime.hasModelForRole("gatekeeper")
        ? options.modelRuntime.getModelForRole("gatekeeper")
        : undefined));
  return !gatekeeperConfigured || (!gatekeeperOptions?.classifier && !gatekeeperModel)
    ? undefined
    : createTaskScopeGatekeeper({
        ...gatekeeperOptions,
        model: gatekeeperModel,
      });
}

function buildOrchestratedDeepAgentGraph(options: CreateOrchestratedDeepAgentGraphOptions) {
  configureLangSmithTracing(options.langSmith);
  const gatekeeper = resolveGatekeeper(options);
  const ctx = createNodeContext(options, gatekeeper);

  const builder = new StateGraph(OrchestratedStateAnnotation)
    .addNode("gatekeeper", createGatekeeperNode(ctx))
    .addNode("route_intake", createIntakeNode(ctx))
    .addNode("clarify", createClarifyNode(ctx))
    .addNode("research", createResearchNode(ctx))
    .addNode("code", createCodeNode(ctx))
    .addNode("finalizer", createFinalizerNode(ctx))
    .addEdge(START, "gatekeeper")
    .addConditionalEdges("gatekeeper", (state) => (state.next === "blocked" ? END : "route_intake"))
    .addConditionalEdges("route_intake", (state) => routeToNextNode(state, "clarify"))
    .addConditionalEdges("clarify", (state) => routeToNextNode(state, END))
    .addConditionalEdges("research", (state) => routeToNextNode(state, END))
    .addConditionalEdges("code", (state) => routeToNextNode(state, END))
    .addEdge("finalizer", END);

  return builder.compile();
}

export type OrchestratedDeepAgentGraph = ReturnType<typeof buildOrchestratedDeepAgentGraph>;

export function createOrchestratedDeepAgentGraph(
  options: CreateOrchestratedDeepAgentGraphOptions,
): OrchestratedDeepAgentGraph {
  return buildOrchestratedDeepAgentGraph(options);
}
