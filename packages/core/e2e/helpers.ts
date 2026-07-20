import {
  type A2UIValidationError,
  type ComponentInstance,
  createModelRuntime,
  type ModelUiOutput,
  type ModelUiUpdate,
  type ProductBatch,
  type UiUpdate,
  validateModelUiOutput,
} from "../src/index.ts";

export const LLM_BASE_URL = process.env.LLM_BASE_URL?.trim();
export const LLM_API_KEY = process.env.LLM_API_KEY?.trim();
export const MODEL_ID = "deepseek-v4-flash";

export const hasLiveLLMCredentials = Boolean(
  process.env.RUN_LIVE_E2E === "1" && LLM_BASE_URL && LLM_API_KEY,
);

/** Two attempts is the canonical budget for model variance. */
export const LIVE_MAX_ATTEMPTS = 2;

/** Per-attempt timeout. The full live suite is sequential and ~10 minutes. */
export const LIVE_ATTEMPT_TIMEOUT_MS = 90_000;

/** Whole-test timeout leaves headroom for both attempts plus diagnostics. */
export const LIVE_TEST_TIMEOUT_MS = LIVE_ATTEMPT_TIMEOUT_MS * LIVE_MAX_ATTEMPTS + 30_000;

export type StructuredPayload = Record<string, unknown>;
export type AgentInvokeResult = { files?: Record<string, unknown>; messages?: unknown[] };
export type TaskToolMessage = { name: string; content: unknown; tool_call_id: string };

export function findToolMessage(
  messages: unknown[] | undefined,
  name: string,
): TaskToolMessage | undefined {
  if (!messages) return undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as Record<string, unknown> | undefined;
    if (!message || typeof message !== "object") continue;
    if (typeof message.tool_call_id === "string" && message.name === name) {
      return {
        name,
        content: message.content,
        tool_call_id: message.tool_call_id,
      };
    }
  }
  return undefined;
}

export function createDefaultModelRuntime(thinking: boolean) {
  return createModelRuntime({
    connections: {
      default: {
        provider: "openai-compatible",
        apiKey: LLM_API_KEY ?? "",
        baseURL: LLM_BASE_URL ?? "",
      },
    },
    categories: {
      fast: {
        connection: "default",
        model: MODEL_ID,
        temperature: 0,
        maxRetries: 3,
        timeout: 30_000,
        providerOptions: {
          modelKwargs: { thinking: { type: thinking ? "enabled" : "disabled" } },
        },
      },
      normal: {
        connection: "default",
        model: MODEL_ID,
        temperature: 0,
        maxRetries: 3,
        timeout: 30_000,
        providerOptions: {
          modelKwargs: { thinking: { type: thinking ? "enabled" : "disabled" } },
        },
      },
      pro: {
        connection: "default",
        model: MODEL_ID,
        temperature: 0,
        maxRetries: 3,
        timeout: 30_000,
        providerOptions: {
          modelKwargs: { thinking: { type: thinking ? "enabled" : "disabled" } },
        },
      },
    },
    assignments: { default: "normal" },
  });
}

export function findTaskToolMessage(messages: unknown[] | undefined): TaskToolMessage | undefined {
  if (!messages) return undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as Record<string, unknown> | undefined;
    if (!message || typeof message !== "object") continue;
    if (typeof message.tool_call_id === "string" && message.name === "task") {
      return {
        name: message.name,
        content: message.content,
        tool_call_id: message.tool_call_id,
      };
    }
  }
  return undefined;
}

const JSON_FENCE_PATTERN = /```(?:json)?\s*([\s\S]*?)```/;

function braceBalancedSpans(content: string): string[] {
  const spans: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === "}") {
      if (depth > 0) {
        depth -= 1;
        if (depth === 0 && start !== -1) {
          spans.push(content.slice(start, index + 1));
          start = -1;
        }
      }
    }
  }
  return spans;
}

function extractJsonObject(content: string): string {
  const candidates: string[] = [];
  const fenced = content.match(JSON_FENCE_PATTERN);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  candidates.push(content.trim());
  for (const span of braceBalancedSpans(content)) candidates.push(span);

  for (const candidate of candidates) {
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // try the next candidate
    }
  }
  return candidates[candidates.length - 1] ?? content.trim();
}

export function parseTaskToolPayload(message: TaskToolMessage | undefined): StructuredPayload {
  if (!message) {
    throw new Error("No task tool message was found in the agent result.");
  }
  if (typeof message.content !== "string" || message.content.length === 0) {
    throw new Error("The task tool message did not carry string content.");
  }
  try {
    return JSON.parse(extractJsonObject(message.content)) as StructuredPayload;
  } catch {
    throw new Error(`The task tool content was not valid JSON: ${message.content.slice(0, 200)}`);
  }
}

export function parseToolMessagePayload(
  message: TaskToolMessage | undefined,
  name: string,
): StructuredPayload {
  if (!message) {
    throw new Error(`No ${name} tool message was found in the agent result.`);
  }
  if (typeof message.content !== "string" || message.content.length === 0) {
    throw new Error(`The ${name} tool message did not carry string content.`);
  }
  try {
    return JSON.parse(extractJsonObject(message.content)) as StructuredPayload;
  } catch {
    throw new Error(
      `The ${name} tool content was not valid JSON: ${message.content.slice(0, 200)}`,
    );
  }
}

export function findTaskToolMessageWithValidPayload(
  messages: unknown[] | undefined,
  validate: (payload: StructuredPayload) => boolean,
): TaskToolMessage | undefined {
  if (!messages) return undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as Record<string, unknown> | undefined;
    if (!message || typeof message !== "object") continue;
    if (typeof message.tool_call_id !== "string" || message.name !== "task") continue;
    if (typeof message.content !== "string" || message.content.length === 0) continue;
    let payload: StructuredPayload;
    try {
      payload = JSON.parse(extractJsonObject(message.content)) as StructuredPayload;
    } catch {
      continue;
    }
    let accepted = false;
    try {
      accepted = validate(payload);
    } catch {
      accepted = false;
    }
    if (accepted) {
      return {
        name: message.name,
        content: message.content,
        tool_call_id: message.tool_call_id,
      };
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Shared live harness
// ---------------------------------------------------------------------------

/**
 * Every live scenario runs through this harness so retry, transcript capture,
 * and diagnostics stay identical. The harness never weakens validation: each
 * scenario asserts its own contract via the assertion callback, and the final
 * thrown error carries every diagnostic we have.
 */

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

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}…`;
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
  const taskCalls: LiveScenarioDiagnostics["taskCalls"] = collectTaskDelegations(messages).map(
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

// ---------------------------------------------------------------------------
// Presentation / catalogue validation helpers
// ---------------------------------------------------------------------------

export type PresentationValidation = {
  ok: boolean;
  output?: ModelUiOutput;
  issues: A2UIValidationError[];
};

/**
 * Validates a presentation output through the production validator and returns
 * the structured issues for diagnostics. Identical to the contract used in
 * generative-ui.e2e.test.ts.
 */
export function validatePresentationOutput(value: unknown): PresentationValidation {
  const result = validateModelUiOutput(value);
  if (result.ok) return { ok: true, output: result.output, issues: [] };
  return { ok: false, issues: result.issues };
}

/**
 * Returns every UI update inside a validated ModelUiOutput. The caller asserts
 * the catalogue contract (root ids, child refs, component names) on the result.
 */
export function extractUiUpdates(output: ModelUiOutput): Extract<ModelUiUpdate, { type: "ui" }>[] {
  return output.updates.filter(
    (update): update is Extract<ModelUiUpdate, { type: "ui" }> => update.type === "ui",
  );
}

export type ProductPresentationComparison = {
  matched: boolean;
  issues: string[];
  cards: ComponentInstance[];
  grid?: ComponentInstance;
};

/**
 * Compares a UI update against an accepted ProductBatch. Mirrors the production
 * invariant in workflow/presentation.ts but returns structured issues so the
 * scenario can include them in its diagnostics.
 */
export function compareProductCards(
  update: Extract<ModelUiUpdate, { type: "ui" }> | undefined,
  batch: ProductBatch,
): ProductPresentationComparison {
  const issues: string[] = [];
  if (!update) {
    return { matched: false, issues: ["No UI update was produced."], cards: [] };
  }
  const grids = update.components.filter((component) => component.component === "ProductGrid");
  const grid = grids[0];
  if (grids.length !== 1) issues.push("Return exactly one ProductGrid.");
  if (!grid || grid.id !== batch.gridRoot || update.rootId !== batch.gridRoot) {
    issues.push(`Use ProductGrid root ${batch.gridRoot}.`);
  }
  const cards = update.components.filter((component) => component.component === "ProductCard");
  if (cards.length !== batch.products.length) {
    issues.push(`Return exactly ${batch.products.length} ProductCard components.`);
  }
  if (
    grid &&
    JSON.stringify(grid.children ?? []) !==
      JSON.stringify(batch.products.map((product) => product.id))
  ) {
    issues.push("ProductGrid children must contain every approved product ID in order.");
  }
  for (const product of batch.products) {
    const card = cards.find((candidate) => candidate.id === product.id);
    if (!card) {
      issues.push(`Missing approved product ${product.id}.`);
      continue;
    }
    if (card.title !== product.title) issues.push(`${product.id} title changed.`);
    if (card.description !== product.description) {
      issues.push(`${product.id} description changed.`);
    }
    if (card.imagePrompt !== product.imagePrompt) {
      issues.push(`${product.id} image prompt changed.`);
    }
  }
  return { matched: issues.length === 0, issues, cards, grid };
}

// ---------------------------------------------------------------------------
// Typed workflow submission helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Activity streaming helpers
// ---------------------------------------------------------------------------

export type ActivityEventTimelines = {
  mainAgent: Array<Extract<UiUpdate, { type: "main_agent_activity" }>>;
  subagentsByRunId: Map<string, Array<Extract<UiUpdate, { type: "subagent_activity" }>>>;
  subagentsByName: Map<string, Array<Extract<UiUpdate, { type: "subagent_activity" }>>>;
  otherUpdates: UiUpdate[];
};

/** Buckets streamed updates by activity surface for scenario 4. */
export function bucketActivity(updates: UiUpdate[]): ActivityEventTimelines {
  const mainAgent: ActivityEventTimelines["mainAgent"] = [];
  const subagentsByRunId = new Map<
    string,
    Array<Extract<UiUpdate, { type: "subagent_activity" }>>
  >();
  const subagentsByName = new Map<
    string,
    Array<Extract<UiUpdate, { type: "subagent_activity" }>>
  >();
  const otherUpdates: UiUpdate[] = [];

  for (const update of updates) {
    if (update.type === "main_agent_activity") {
      mainAgent.push(update);
      continue;
    }
    if (update.type === "subagent_activity") {
      const runId = update.subagentRunId ?? "(unknown)";
      const byRun = subagentsByRunId.get(runId) ?? [];
      byRun.push(update);
      subagentsByRunId.set(runId, byRun);
      const byName = subagentsByName.get(update.subagentName) ?? [];
      byName.push(update);
      subagentsByName.set(update.subagentName, byName);
      continue;
    }
    otherUpdates.push(update);
  }

  return { mainAgent, subagentsByRunId, subagentsByName, otherUpdates };
}

/** Ensures a timeline includes started/delta/completed events. */
export function assertActivityLifecycle(
  timeline: Array<{ event: string; text?: string; task?: string }>,
  label: string,
): void {
  const events = timeline.map((entry) => entry.event);
  if (!events.includes("started")) {
    throw new Error(`${label} never emitted a started event (events=${events.join(",")}).`);
  }
  if (!events.includes("delta")) {
    throw new Error(`${label} never emitted a delta event (events=${events.join(",")}).`);
  }
  if (!events.includes("completed")) {
    throw new Error(`${label} never emitted a completed event (events=${events.join(",")}).`);
  }
}
