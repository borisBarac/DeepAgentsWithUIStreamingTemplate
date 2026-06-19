import { END } from "@langchain/langgraph";

import type { OrchestratedDeepAgentRoute, OrchestratedDeepAgentRoutingOptions } from "./types.ts";

const RESEARCH_KEYWORDS =
  /\b(research|investigate|explore|find|summar|analyz|study|compare|survey|look up|gather)\b/;
const CODING_KEYWORDS =
  /\b(code|implement|build|refactor|function|bug|fix|test|deploy|api|script|class)\b/;

export function selectWorkRoute(
  task: string,
  routing: OrchestratedDeepAgentRoutingOptions,
): OrchestratedDeepAgentRoute {
  const enableResearch = routing.enableResearch ?? true;
  const enableCoding = routing.enableCoding ?? true;
  const lowered = task.toLowerCase();

  if (enableCoding && CODING_KEYWORDS.test(lowered)) {
    return "code";
  }
  if (enableResearch && RESEARCH_KEYWORDS.test(lowered)) {
    return "research";
  }
  if (enableResearch) {
    return "research";
  }
  if (enableCoding) {
    return "code";
  }
  return "final";
}

export function nextNodeName(
  next: OrchestratedDeepAgentRoute,
  options: { clarifyTarget: string },
): string {
  switch (next) {
    case "clarify":
      return options.clarifyTarget;
    case "research":
      return "research";
    case "code":
      return "code";
    case "final":
      return "finalizer";
    default:
      return END;
  }
}

export function routeToNextNode(
  state: { next: OrchestratedDeepAgentRoute },
  clarifyTarget: string,
): string {
  return nextNodeName(state.next, { clarifyTarget });
}
