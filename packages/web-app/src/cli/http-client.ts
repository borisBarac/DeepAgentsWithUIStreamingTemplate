import type { UiUpdate } from "@deep-agent-template/core/generative-ui/types";

import { parseClientUpdateLine } from "../ui/validate-spec.ts";

export type AgentHttpClientOptions = {
  baseUrl: string;
  includeActivity: boolean;
  message: string;
  sessionId: string;
  signal?: AbortSignal;
};

export type AgentHttpError = {
  kind: "http";
  status: number;
  message: string;
};

export type AgentStreamHandlers = {
  onUpdate: (update: UiUpdate) => void;
  onError?: (error: AgentHttpError) => void;
};

function joinUrl(base: string, path: string): string {
  const trimmed = base.replace(/\/+$/, "");
  return `${trimmed}${path}`;
}

/**
 * Streams updates from `/api/agent`. Mirrors the line-buffering AND validation
 * logic in `src/ui/use-agent-chat.ts` so the CLI sees the same chunk
 * boundaries AND the same per-line validation errors as the website:
 *
 * 1. Partial NDJSON lines are buffered across `reader.read()` chunks and
 *    dispatched only once the terminating newline arrives.
 * 2. Each completed frame's `update` is parsed with `parseClientUpdateLine` (the same
 *    helper the website's `applyAgentChatLine` uses). Malformed JSON or
 *    schema-invalid updates surface as a synthetic `{type:"error"}`
 *    update — matching the website's `handlers.onError(...)` path.
 */
export async function streamAgentUpdates(
  options: AgentHttpClientOptions,
  handlers: AgentStreamHandlers,
): Promise<void> {
  const url = joinUrl(options.baseUrl, "/api/agent");
  let response: Response;
  try {
    response = await fetch(url, {
      body: JSON.stringify({
        includeSubagentActivity: options.includeActivity,
        message: options.message,
        sessionId: options.sessionId,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal: options.signal,
    });
  } catch (error) {
    handlers.onError?.({
      kind: "http",
      status: 0,
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  if (!response.ok || !response.body) {
    const message = await safeReadText(response);
    handlers.onError?.({
      kind: "http",
      status: response.status,
      message: message || `Request failed with status ${response.status}.`,
    });
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        dispatchLine(trimmed, handlers);
      }
    }
    const tail = buffered.trim();
    if (tail) {
      dispatchLine(tail, handlers);
    }
  } finally {
    reader.releaseLock();
  }
}

function dispatchLine(line: string, handlers: AgentStreamHandlers): void {
  const result = parseClientUpdateLine(unwrapUpdate(line));
  if (result.ok) {
    handlers.onUpdate(result.update);
    return;
  }
  // Mirror applyAgentChatLine's error path: invalid lines become a synthetic
  // error update so the session-state and renderer treat them like any
  // server-emitted error.
  const message = result.issues[0]?.message ?? "UI update was rejected by the validator.";
  handlers.onUpdate({ type: "error", message });
}

function unwrapUpdate(line: string): string {
  try {
    const frame = JSON.parse(line) as { update?: unknown };
    if (typeof frame === "object" && frame !== null && frame.update !== undefined) {
      return JSON.stringify(frame.update);
    }
  } catch {
    // Let parseClientUpdateLine produce the consistent validation error.
  }
  return line;
}

async function safeReadText(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.trim().slice(0, 500);
  } catch {
    return "";
  }
}
