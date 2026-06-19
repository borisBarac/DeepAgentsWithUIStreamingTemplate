import { createModelRuntime } from "../src/index.ts";

export const LLM_BASE_URL = process.env.LLM_BASE_URL?.trim();
export const LLM_API_KEY = process.env.LLM_API_KEY?.trim();
export const MODEL_ID = "deepseek-v4-flash";

export const hasLiveLLMCredentials = Boolean(LLM_BASE_URL && LLM_API_KEY);

export type StructuredPayload = Record<string, unknown>;
export type AgentInvokeResult = { messages?: unknown[] };
export type TaskToolMessage = { name: string; content: unknown; tool_call_id: string };

export function createDefaultModelRuntime(thinking: boolean) {
  return createModelRuntime({
    connections: {
      default: { apiKey: LLM_API_KEY ?? "", baseURL: LLM_BASE_URL ?? "" },
    },
    models: {
      default: {
        connection: "default",
        model: MODEL_ID,
        providerOptions: {
          modelKwargs: { thinking: { type: thinking ? "enabled" : "disabled" } },
        },
      },
    },
    assignments: { default: "default" },
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

export function parseTaskToolPayload(message: TaskToolMessage | undefined): StructuredPayload {
  if (!message) {
    throw new Error("No task tool message was found in the agent result.");
  }
  if (typeof message.content !== "string" || message.content.length === 0) {
    throw new Error("The task tool message did not carry string content.");
  }
  try {
    return JSON.parse(message.content) as StructuredPayload;
  } catch {
    throw new Error(`The task tool content was not valid JSON: ${message.content.slice(0, 200)}`);
  }
}
