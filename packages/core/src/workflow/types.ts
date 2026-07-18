import type {
  ClarificationResult,
  ClarificationState,
  ClarificationTriageClassifier,
  ClarificationTriageDecision,
} from "../clarification/index.ts";
import type { PromptLoader } from "../prompts/index.ts";
import type { ReviewReport } from "../review/index.ts";

export type WorkflowPhase =
  | "clarification"
  | "waiting_for_user"
  | "execution"
  | "review"
  | "revision"
  | "delivery_ready"
  | "error";

export const WORKFLOW_PHASES: ReadonlySet<WorkflowPhase> = new Set<WorkflowPhase>([
  "clarification",
  "waiting_for_user",
  "execution",
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
  reviewHistory: ReviewReport[];
  revisionCount: number;
  controllerRetryCount: number;
  terminalError?: WorkflowError;
  caveated: boolean;
  lastFeedback?: string;
  completedSubagent?: WorkflowDecision["requiredSubagent"];
  /**
   * The most recent user message that the triage classifier has already
   * evaluated. Prevents redundant classifier calls within a single turn
   * (the workflow controller's `beforeAgent` hook fires on every agent
   * invocation; without this memo the same message would be re-classified
   * on each round-trip).
   */
  lastTriageMessage?: string;
  /**
   * The most recent triage decision recorded for {@link lastTriageMessage}.
   * Surfaced for transcript inspection and tests; not consulted by the reducer.
   */
  lastTriageDecision?: ClarificationTriageDecision;
};

export type WorkflowEvent =
  | { type: "subagent_completed"; subagent: NonNullable<WorkflowDecision["requiredSubagent"]> }
  | { type: "clarification_completed"; result: ClarificationResult; state: ClarificationState }
  | { type: "user_replied" }
  | { type: "execution_completed"; outcome: WorkflowOutcomePacket }
  | { type: "review_completed"; report: ReviewReport; maxRevisions: number }
  | { type: "controller_feedback"; message: string; retryLimit: number };

export type WorkflowDecision = {
  phase: WorkflowPhase;
  requiredAction:
    | "clarify"
    | "wait_for_user"
    | "execute"
    | "review"
    | "revise"
    | "deliver"
    | "fail";
  requiredSubagent?: "clarifier" | "review-agent";
  canFinalize: boolean;
  feedback?: string;
};

export type WorkflowControllerOptions = {
  maxClarificationRounds: number;
  questionsPerRound: 1 | 2 | 3;
  maxRevisions: number;
  controllerRetryLimit?: number;
  /**
   * Pre-clarifier triage gate. When provided AND `triageEnabled` is not `false`,
   * each new entry into the `clarification` phase invokes the classifier once.
   * If it returns `skip`, the phase transitions straight to `execution` with a
   * synthetic `ready_to_proceed` result carrying
   * {@link ClarificationSkipReason}`.triage_classifier`. Omit this field to
   * preserve the legacy always-clarify behavior.
   */
  triageClassifier?: ClarificationTriageClassifier;
  /**
   * Defaults to `true` when a {@link triageClassifier} is present. Set to
   * `false` to forcibly disable triage even when a classifier is supplied
   * (useful for unit tests that pin legacy behavior).
   */
  triageEnabled?: boolean;
  /**
   * Optional prompt loader used to render the triage classifier prompt. When
   * omitted, the controller falls back to the inline template in
   * `clarification/triage.ts`.
   */
  promptLoader?: PromptLoader;
};
