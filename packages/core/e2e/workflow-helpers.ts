import { extractJsonObject, type StructuredPayload, type TaskToolMessage } from "./json-helpers.ts";
import {
  LiveScenarioDiagnosticCarrier,
  type LiveScenarioDiagnostics,
  truncate,
} from "./live-harness.ts";

export const WORKFLOW_TASK_TOOL_NAME = "task";
export const WORKFLOW_CLARIFICATION_TOOL = "workflow_submit_clarification";
export const WORKFLOW_EXECUTION_TOOL = "workflow_complete_execution";
export const WORKFLOW_PRODUCTS_TOOL = "workflow_submit_products";
export const WORKFLOW_REVIEW_TOOL = "workflow_submit_review";

export type WorkflowSubmissionStatus = {
  name: string;
  status: string;
  nextPhase?: string;
  error?: string;
  /** The typed arguments the supervisor sent into the tool call. */
  requestArgs?: StructuredPayload;
  /** The tool-response payload returned to the supervisor. */
  payload?: StructuredPayload;
};

/**
 * Walks the message transcript and returns every typed workflow_submit_* tool
 * interaction. Each entry carries BOTH the request arguments (from the
 * AIMessage.tool_calls) and the response payload (from the ToolMessage), so
 * callers can inspect the actual product batch / clarification result even
 * though the response only echoes `{status, nextPhase}`.
 */
export function collectWorkflowSubmissions(messages: unknown[]): WorkflowSubmissionStatus[] {
  const responsesByCallId = new Map<string, StructuredPayload>();
  for (const message of messages) {
    if (typeof message !== "object" || message === null) continue;
    const record = message as Record<string, unknown>;
    if (
      typeof record.tool_call_id !== "string" ||
      typeof record.name !== "string" ||
      typeof record.content !== "string" ||
      !record.name.startsWith("workflow_")
    ) {
      continue;
    }
    let payload: StructuredPayload | undefined;
    try {
      payload = JSON.parse(extractJsonObject(record.content)) as StructuredPayload;
    } catch {
      payload = undefined;
    }
    if (payload) responsesByCallId.set(record.tool_call_id, payload);
  }

  const submissions: WorkflowSubmissionStatus[] = [];
  for (const message of messages) {
    if (typeof message !== "object" || message === null) continue;
    const record = message as Record<string, unknown>;
    const toolCalls = Array.isArray(record.tool_calls) ? record.tool_calls : [];
    for (const toolCall of toolCalls) {
      if (typeof toolCall !== "object" || toolCall === null) continue;
      const call = toolCall as Record<string, unknown>;
      if (typeof call.name !== "string" || !call.name.startsWith("workflow_")) continue;
      const id = typeof call.id === "string" ? call.id : "";
      const args = (call.args ?? {}) as StructuredPayload;
      const response = id ? responsesByCallId.get(id) : undefined;
      submissions.push({
        name: call.name,
        status: typeof response?.status === "string" ? response.status : "(no response)",
        nextPhase: typeof response?.nextPhase === "string" ? response.nextPhase : undefined,
        error: typeof response?.error === "string" ? response.error : undefined,
        requestArgs: args,
        payload: response,
      });
    }
  }
  return submissions;
}

/**
 * Returns the task delegations observed in the transcript in the order they
 * were issued by the supervisor. Walks AIMessage.tool_calls for the original
 * delegation request (which carries subagent_type), not the ToolMessage
 * result (which carries the subagent's prose response).
 */
export function collectTaskDelegations(
  messages: unknown[],
): Array<{ subagent: string; preview: string; raw: string }> {
  const calls: Array<{ subagent: string; preview: string; raw: string }> = [];
  for (const message of messages) {
    if (typeof message !== "object" || message === null) continue;
    const record = message as Record<string, unknown>;
    const toolCalls = Array.isArray(record.tool_calls) ? record.tool_calls : [];
    for (const toolCall of toolCalls) {
      if (typeof toolCall !== "object" || toolCall === null) continue;
      const call = toolCall as Record<string, unknown>;
      if (call.name !== WORKFLOW_TASK_TOOL_NAME) continue;
      const args = (call.args ?? {}) as Record<string, unknown>;
      const subagent = typeof args.subagent_type === "string" ? args.subagent_type : "(unknown)";
      const description = typeof args.description === "string" ? args.description : "";
      calls.push({
        subagent,
        preview: truncate(description || JSON.stringify(args), 120),
        raw: JSON.stringify(args),
      });
    }
  }
  return calls;
}

/**
 * Pulls the accepted submission payload for a specific workflow tool out of
 * the transcript. Throws a diagnostic-carrier error when none is accepted so
 * scenario tests can surface the full transcript on failure.
 */
export function requireAcceptedSubmission(
  messages: unknown[],
  toolName: string,
): StructuredPayload {
  const submissions = collectWorkflowSubmissions(messages);
  const accepted = submissions.find(
    (submission) => submission.name === toolName && submission.status === "accepted",
  );
  if (!accepted?.payload) {
    throw new LiveScenarioDiagnosticCarrier(
      `No accepted ${toolName} submission was found in the transcript.`,
      {
        submissionResults: submissions.map((submission) => ({
          name: submission.name,
          status: submission.status,
          nextPhase: submission.nextPhase,
        })),
      },
    );
  }
  return accepted.payload;
}

/** Ensures the given task delegations all appear at least once, in order. */
export function assertTaskDelegationsInOrder(
  messages: unknown[],
  expected: readonly string[],
): void {
  const calls = collectTaskDelegations(messages).map((call) => call.subagent);
  let cursor = 0;
  for (const expectedSubagent of expected) {
    const nextIndex = calls.indexOf(expectedSubagent, cursor);
    if (nextIndex === -1) {
      throw new LiveScenarioDiagnosticCarrier(
        `Expected task delegation '${expectedSubagent}' was not observed after '${calls[cursor - 1] ?? "<start>"}'.`,
        {
          taskCalls: collectTaskDelegations(messages).map((call) => ({
            subagent: call.subagent,
            preview: call.preview,
          })),
        },
      );
    }
    cursor = nextIndex + 1;
  }
}

/** Ensures the given workflow submissions were all accepted, in order. */
export function assertSubmissionsAcceptedInOrder(
  messages: unknown[],
  expected: readonly string[],
): WorkflowSubmissionStatus[] {
  const submissions = collectWorkflowSubmissions(messages);
  let cursor = 0;
  for (const expectedName of expected) {
    const nextIndex = submissions.findIndex(
      (submission, index) =>
        index >= cursor && submission.name === expectedName && submission.status === "accepted",
    );
    if (nextIndex === -1) {
      throw new LiveScenarioDiagnosticCarrier(
        `Expected accepted ${expectedName} submission was not observed after index ${cursor}.`,
        {
          submissionResults: submissions.map((submission) => ({
            name: submission.name,
            status: submission.status,
            nextPhase: submission.nextPhase,
          })),
        },
      );
    }
    cursor = nextIndex + 1;
  }
  return submissions;
}

export type { LiveScenarioDiagnostics, TaskToolMessage };
