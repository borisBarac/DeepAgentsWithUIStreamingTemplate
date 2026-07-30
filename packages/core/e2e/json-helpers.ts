import { createModelRuntime } from "../src/index.ts";

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

/** Whole-test timeout leaves headroom for both attempts plus overhead. */
export const LIVE_TEST_TIMEOUT_MS = LIVE_ATTEMPT_TIMEOUT_MS * LIVE_MAX_ATTEMPTS + 30_000;

export type AgentInvokeResult = { files?: Record<string, unknown>; messages?: unknown[] };
export type StructuredPayload = Record<string, unknown>;
export type TaskToolMessage = { name: string; content: unknown; tool_call_id: string };

// Single-tier model runtime for the live e2e suites. All three categories point
// at the same deepseek-v4-flash model with thinking disabled for speed and
// deterministic, reproducible runs. Reused by the sandbox/langsmith in-process
// suites and the web-app worker round-trip e2e.
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

/** Finds the last ToolMessage carrying the given tool name, if any. */
export function findToolMessage(
  messages: unknown[] | undefined,
  name: string,
): TaskToolMessage | undefined {
  if (!messages) return undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as Record<string, unknown> | undefined;
    if (!message || typeof message !== "object") continue;
    if (typeof message.tool_call_id === "string" && message.name === name) {
      return { name, content: message.content, tool_call_id: message.tool_call_id };
    }
  }
  return undefined;
}

export function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}…`;
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
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
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

/** Best-effort extraction of a JSON object from model/tool text. */
export function extractJsonObject(content: string): string {
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

export function parseToolMessagePayload(
  message: TaskToolMessage | undefined,
  name: string,
): StructuredPayload {
  if (!message) throw new Error(`No ${name} tool message was found in the agent result.`);
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

export type WorkflowSubmissionStatus = {
  name: string;
  status: string;
  nextPhase?: string;
};

/**
 * Returns every typed workflow_submit_* tool interaction observed in the
 * transcript, with the accepted/rejected status the controller echoed back.
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
      const response = id ? responsesByCallId.get(id) : undefined;
      submissions.push({
        name: call.name,
        status: typeof response?.status === "string" ? response.status : "(no response)",
        nextPhase: typeof response?.nextPhase === "string" ? response.nextPhase : undefined,
      });
    }
  }
  return submissions;
}

/** Returns the `task` delegations observed in the transcript, in order. */
export function collectTaskDelegations(
  messages: unknown[],
): Array<{ subagent: string; preview: string }> {
  const calls: Array<{ subagent: string; preview: string }> = [];
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
      calls.push({ subagent, preview: truncate(description || JSON.stringify(args), 120) });
    }
  }
  return calls;
}
