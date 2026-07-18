import { createModelRuntime } from "../src/index.ts";

export const LLM_BASE_URL = process.env.LLM_BASE_URL?.trim();
export const LLM_API_KEY = process.env.LLM_API_KEY?.trim();
export const MODEL_ID = "deepseek-v4-flash";

export const hasLiveLLMCredentials = Boolean(
  process.env.RUN_LIVE_E2E === "1" && LLM_BASE_URL && LLM_API_KEY,
);

export type StructuredPayload = Record<string, unknown>;
export type AgentInvokeResult = { messages?: unknown[] };
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
