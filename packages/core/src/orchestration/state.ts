import { Annotation } from "@langchain/langgraph";
import type { ClarificationState } from "../clarification/index.ts";
import type { TaskScopeDecision } from "../guardrails/index.ts";
import type { ReviewState } from "../review/index.ts";
import type {
  OrchestratedDeepAgentError,
  OrchestratedDeepAgentMessage,
  OrchestratedDeepAgentRoute,
} from "./types.ts";

export const OrchestratedStateAnnotation = Annotation.Root({
  task: Annotation<string>,
  messages: Annotation<OrchestratedDeepAgentMessage[]>({
    default: () => [],
    reducer: (current, next) => [...(current ?? []), ...(next ?? [])],
  }),
  gatekeeperDecision: Annotation<TaskScopeDecision | undefined>({
    default: () => undefined,
    reducer: (_current, next) => next,
  }),
  clarification: Annotation<ClarificationState | undefined>({
    default: () => undefined,
    reducer: (_current, next) => next,
  }),
  researchResult: Annotation<string | undefined>({
    default: () => undefined,
    reducer: (_current, next) => next,
  }),
  codeResult: Annotation<string | undefined>({
    default: () => undefined,
    reducer: (_current, next) => next,
  }),
  finalAnswer: Annotation<string | undefined>({
    default: () => undefined,
    reducer: (_current, next) => next,
  }),
  review: Annotation<ReviewState | undefined>({
    default: () => undefined,
    reducer: (_current, next) => next,
  }),
  next: Annotation<OrchestratedDeepAgentRoute>({
    default: () => "final",
    reducer: (_current, next) => next,
  }),
  errors: Annotation<OrchestratedDeepAgentError[]>({
    default: () => [],
    reducer: (current, next) => [...(current ?? []), ...(next ?? [])],
  }),
});

export type OrchestratedGraphState = typeof OrchestratedStateAnnotation.State;

export type OrchestratedGraphContextState = {
  task: string;
  messages: OrchestratedDeepAgentMessage[];
  gatekeeperDecision?: TaskScopeDecision;
  clarification?: ClarificationState;
  researchResult?: string;
  codeResult?: string;
  finalAnswer?: string;
  review?: ReviewState;
  next: OrchestratedDeepAgentRoute;
  errors: OrchestratedDeepAgentError[];
};

export type OrchestratedStateAnnotationType = typeof OrchestratedStateAnnotation;
