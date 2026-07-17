import type { ClarificationResult, ClarificationState } from "../clarification/index.ts";
import type { ProductCardBatch } from "../generative-ui/index.ts";
import type { ReviewReport } from "../review/index.ts";

export type WorkflowPhase =
  | "clarification"
  | "waiting_for_user"
  | "execution"
  | "product_generation"
  | "review"
  | "revision"
  | "delivery_ready"
  | "error";

export const WORKFLOW_PHASES: ReadonlySet<WorkflowPhase> = new Set<WorkflowPhase>([
  "clarification",
  "waiting_for_user",
  "execution",
  "product_generation",
  "review",
  "revision",
  "delivery_ready",
  "error",
]);

export type WorkflowOutcomePacket = {
  candidateFinalResponse: string;
  deliverables: string[];
  validationEvidence: string[];
  assumptions: string[];
};

export type WorkflowError = {
  code: "controller_retry_exhausted" | "invalid_transition" | "malformed_output_limit_exceeded";
  message: string;
  phase: WorkflowPhase;
};

export type WorkflowState = {
  phase: WorkflowPhase;
  originalRequest: string;
  clarification: ClarificationState | null;
  clarificationResult?: ClarificationResult;
  assumptions: string[];
  outcome?: WorkflowOutcomePacket;
  productBatch?: ProductCardBatch;
  reviewHistory: ReviewReport[];
  revisionCount: number;
  controllerRetryCount: number;
  terminalError?: WorkflowError;
  caveated: boolean;
  lastFeedback?: string;
};

export type WorkflowEvent =
  | { type: "clarification_completed"; result: ClarificationResult; state: ClarificationState }
  | { type: "user_replied" }
  | { type: "execution_completed"; outcome: WorkflowOutcomePacket; generativeUiEnabled: boolean }
  | { type: "product_generated"; batch: ProductCardBatch }
  | { type: "review_completed"; report: ReviewReport; maxRevisions: number }
  | { type: "controller_feedback"; message: string; retryLimit: number };

export type WorkflowDecision = {
  phase: WorkflowPhase;
  requiredAction:
    | "clarify"
    | "wait_for_user"
    | "execute"
    | "generate_products"
    | "review"
    | "revise"
    | "deliver"
    | "fail";
  requiredSubagent?: "clarifier" | "product-generator" | "review-agent";
  canFinalize: boolean;
  feedback?: string;
};

export type WorkflowControllerOptions = {
  maxClarificationRounds: number;
  questionsPerRound: 1 | 2 | 3;
  maxRevisions: number;
  generativeUiEnabled: boolean;
  controllerRetryLimit?: number;
};
