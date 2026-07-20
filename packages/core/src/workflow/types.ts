import type { ClarificationResult, ClarificationState } from "../clarification/index.ts";
import type { QuestionUpdate, UiSpecUpdate } from "../generative-ui/index.ts";
import type { ReviewReport } from "../review/index.ts";
import type { ExistingProductSet, ProductBatch, ProductMode } from "./products.ts";

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
  existingProducts: ExistingProductSet | null;
  productMode: ProductMode;
  targetProductCount: number;
  productGenerationEnabled: boolean;
  generatedProducts?: ProductBatch;
  reviewHistory: ReviewReport[];
  revisionCount: number;
  controllerRetryCount: number;
  terminalError?: WorkflowError;
  caveated: boolean;
  lastFeedback?: string;
  completedSubagent?: WorkflowDecision["requiredSubagent"];
  /**
   * Deterministic UI emitted by the controller (mirrors
   * clarificationResultToQuestionUpdates / productBatchToUiUpdate). Drained
   * by the interaction-stream after the workflow submits a batch or
   * clarification questions. Cleared via the `ui_drained` event so retries
   * do not re-emit.
   */
  pendingProductUi?: UiSpecUpdate;
  pendingClarificationUi?: QuestionUpdate[];
};

export type WorkflowEvent =
  | { type: "subagent_completed"; subagent: NonNullable<WorkflowDecision["requiredSubagent"]> }
  | { type: "clarification_completed"; result: ClarificationResult; state: ClarificationState }
  | { type: "user_replied" }
  | { type: "execution_completed"; outcome: WorkflowOutcomePacket }
  | { type: "products_submitted"; batch: ProductBatch }
  | { type: "review_completed"; report: ReviewReport; maxReviewCycles: number }
  | { type: "controller_feedback"; message: string; retryLimit: number }
  | { type: "ui_drained" };

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
  maxReviewCycles: number;
  controllerRetryLimit?: number;
  productGenerationEnabled?: boolean;
};
