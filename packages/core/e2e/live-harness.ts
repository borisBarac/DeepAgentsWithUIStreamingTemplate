import type { A2UIValidationError } from "../src/index.ts";
import {
  extractJsonObject,
  LIVE_ATTEMPT_TIMEOUT_MS,
  LIVE_MAX_ATTEMPTS,
  type StructuredPayload,
} from "./json-helpers.ts";

export type LiveAttemptContext = {
  attempt: number;
  threadId: string;
  sessionId: string;
};

export type LiveScenarioDiagnostics = {
  attempt: number;
  lastPhase?: string;
  requiredAction?: string;
  taskCalls: Array<{ subagent: string; preview: string }>;
  submissionResults: Array<{ name: string; status: string; nextPhase?: string }>;
  presentationError?: string;
  catalogueValidationIssues: A2UIValidationError[];
  transcript: string;
};

export type LiveScenarioOutcome<T> =
  | { ok: true; value: T; diagnostics: LiveScenarioDiagnostics }
  | { ok: false; error: unknown; diagnostics: LiveScenarioDiagnostics };

export type RunLiveAttempt<T> = (context: LiveAttemptContext) => Promise<{
  value: T;
  collect: (diagnostics: Partial<Omit<LiveScenarioDiagnostics, "attempt">>) => void;
}>;

function uniqueId(prefix: string, attempt: number): string {
  return `${prefix}-${attempt}-${crypto.randomUUID()}`;
}

export function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}…`;
}

/**
 * Enforces the per-attempt timeout. Without this, a hung model call would
 * burn the entire test timeout on a single attempt and we'd never get to
 * attempt 2. The timer rejects with a TimeoutError so the harness can move
 * on; we do not abort the underlying work (LangGraph/Promise cancellation
 * across the agent runtime is unreliable).
 */
export async function withAttemptTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  scenarioName: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        Object.assign(new Error(`Attempt timed out after ${timeoutMs}ms`), {
          name: "AttemptTimeoutError",
          scenarioName,
        }),
      );
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Walks the agent message transcript collecting workflow task delegations and
 * typed workflow_submit_* tool results. Task delegations are read from
 * AIMessage.tool_calls (the request), submission results from ToolMessage
 * content (the response). These are surfaced in diagnostics so a failing live
 * run can be diagnosed without re-running the model.
 */
export function collectWorkflowDiagnostics(messages: unknown[]): {
  taskCalls: LiveScenarioDiagnostics["taskCalls"];
  submissionResults: LiveScenarioDiagnostics["submissionResults"];
  transcript: string;
} {
  const taskCalls: LiveScenarioDiagnostics["taskCalls"] = collectTaskDelegationsRaw(messages).map(
    (call) => ({ subagent: call.subagent, preview: call.preview }),
  );
  const submissionResults: LiveScenarioDiagnostics["submissionResults"] = [];
  const transcriptParts: string[] = [];

  for (const message of messages) {
    if (typeof message !== "object" || message === null) continue;
    const record = message as Record<string, unknown>;

    if (typeof record.content === "string" && record.content.length > 0) {
      transcriptParts.push(
        `[${typeof record.role === "string" ? record.role : "?"}] ${truncate(record.content, 320)}`,
      );
    }

    if (
      typeof record.tool_call_id === "string" &&
      typeof record.name === "string" &&
      typeof record.content === "string" &&
      typeof record.name === "string" &&
      record.name.startsWith("workflow_")
    ) {
      let payload: StructuredPayload | undefined;
      try {
        payload = JSON.parse(extractJsonObject(record.content)) as StructuredPayload;
      } catch {
        payload = undefined;
      }
      if (payload) {
        submissionResults.push({
          name: record.name,
          status: typeof payload.status === "string" ? payload.status : "(no status)",
          nextPhase: typeof payload.nextPhase === "string" ? payload.nextPhase : undefined,
        });
      }
    }
  }

  return {
    taskCalls,
    submissionResults,
    transcript: transcriptParts.join("\n"),
  };
}

function collectTaskDelegationsRaw(
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
      if (call.name !== "task") continue;
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

/** The canonical two-attempt loop, mirroring generative-ui.e2e.test.ts. */
export async function runLiveScenario<T>(
  runAttempt: RunLiveAttempt<T>,
  options: { scenarioName: string; threadPrefix: string },
): Promise<T> {
  let lastError: unknown;
  let lastDiagnostics: LiveScenarioDiagnostics | undefined;

  for (let attempt = 1; attempt <= LIVE_MAX_ATTEMPTS; attempt += 1) {
    const diagnostics: LiveScenarioDiagnostics = {
      attempt,
      taskCalls: [],
      submissionResults: [],
      catalogueValidationIssues: [],
      transcript: "",
    };
    const threadId = uniqueId(options.threadPrefix, attempt);
    const sessionId = threadId;
    try {
      const { value, collect } = await withAttemptTimeout(
        runAttempt({ attempt, threadId, sessionId }),
        LIVE_ATTEMPT_TIMEOUT_MS,
        options.scenarioName,
      );
      collect({});
      return value;
    } catch (error) {
      lastError = error;
      lastDiagnostics = diagnostics;
      if (error instanceof LiveScenarioDiagnosticCarrier) {
        Object.assign(
          diagnostics,
          error.diagnostics as Partial<Omit<LiveScenarioDiagnostics, "attempt">>,
        );
      }
      if (options.scenarioName) {
        console.error(
          `[${options.scenarioName} · attempt ${attempt}] failed:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  }

  if (lastError instanceof LiveScenarioDiagnosticCarrier && lastError.diagnostics) {
    const merged: LiveScenarioDiagnostics = {
      attempt: lastDiagnostics?.attempt ?? LIVE_MAX_ATTEMPTS,
      lastPhase: lastError.diagnostics.lastPhase ?? lastDiagnostics?.lastPhase,
      requiredAction: lastError.diagnostics.requiredAction ?? lastDiagnostics?.requiredAction,
      taskCalls: lastError.diagnostics.taskCalls ?? lastDiagnostics?.taskCalls ?? [],
      submissionResults:
        lastError.diagnostics.submissionResults ?? lastDiagnostics?.submissionResults ?? [],
      presentationError:
        lastError.diagnostics.presentationError ?? lastDiagnostics?.presentationError,
      catalogueValidationIssues:
        lastError.diagnostics.catalogueValidationIssues ??
        lastDiagnostics?.catalogueValidationIssues ??
        [],
      transcript: lastError.diagnostics.transcript ?? lastDiagnostics?.transcript ?? "",
    };
    throw new Error(
      `${options.scenarioName} failed after ${LIVE_MAX_ATTEMPTS} attempts.\n${formatDiagnostics(merged)}`,
      { cause: lastError },
    );
  }

  const diagnosticsBlock = lastDiagnostics ? formatDiagnostics(lastDiagnostics) : "";
  const message = `${options.scenarioName} failed after ${LIVE_MAX_ATTEMPTS} attempts.${diagnosticsBlock ? `\n${diagnosticsBlock}` : ""}`;
  throw lastError instanceof Error ? new Error(message, { cause: lastError }) : new Error(message);
}

export class LiveScenarioDiagnosticCarrier extends Error {
  constructor(
    message: string,
    readonly diagnostics: Partial<LiveScenarioDiagnostics>,
  ) {
    super(message);
    this.name = "LiveScenarioDiagnosticCarrier";
  }
}

export function formatDiagnostics(diagnostics: LiveScenarioDiagnostics): string {
  const lines: string[] = [];
  lines.push(`attempt=${diagnostics.attempt}`);
  if (diagnostics.lastPhase) lines.push(`lastPhase=${diagnostics.lastPhase}`);
  if (diagnostics.requiredAction) lines.push(`requiredAction=${diagnostics.requiredAction}`);

  if (diagnostics.taskCalls.length > 0) {
    lines.push("taskCalls:");
    for (const call of diagnostics.taskCalls) lines.push(`  - ${call.subagent}: ${call.preview}`);
  } else {
    lines.push("taskCalls: (none)");
  }

  if (diagnostics.submissionResults.length > 0) {
    lines.push("submissions:");
    for (const submission of diagnostics.submissionResults) {
      lines.push(
        `  - ${submission.name}: status=${submission.status}${
          submission.nextPhase ? ` nextPhase=${submission.nextPhase}` : ""
        }`,
      );
    }
  } else {
    lines.push("submissions: (none)");
  }

  if (diagnostics.presentationError) {
    lines.push(`presentationError: ${diagnostics.presentationError}`);
  }
  if (diagnostics.catalogueValidationIssues.length > 0) {
    lines.push("catalogueValidationIssues:");
    for (const issue of diagnostics.catalogueValidationIssues) {
      lines.push(`  - ${issue.path} [${issue.code}]: ${issue.message}`);
    }
  }

  if (diagnostics.transcript) {
    lines.push("transcript:");
    lines.push(truncate(diagnostics.transcript, 6_000));
  }
  return lines.join("\n");
}
