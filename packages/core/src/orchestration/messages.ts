import type { DeepAgent } from "deepagents";

import type {
  OrchestratedDeepAgent,
  OrchestratedDeepAgentInvokeOutput,
  OrchestratedDeepAgentMessage,
} from "./types.ts";

type MessageContentPart = { text?: unknown };

function messageContentPartToString(part: unknown): string {
  if (typeof part === "string") {
    return part;
  }
  if (part !== null && typeof part === "object" && "text" in part) {
    return String((part as MessageContentPart).text ?? "");
  }
  return "";
}

function messageContentToString(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => messageContentPartToString(part)).join("");
  }
  return "";
}

export function normalizeMessages(messages: unknown): OrchestratedDeepAgentMessage[] {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter(
      (message): message is Record<string, unknown> =>
        message !== null && typeof message === "object",
    )
    .map((message) => {
      const rawRole = message.role;
      const role = rawRole === "assistant" || rawRole === "system" ? rawRole : "user";
      return { role, content: messageContentToString(message.content) };
    });
}

export function extractStageOutput(messages: unknown): string {
  const normalized = normalizeMessages(messages);
  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    const message = normalized[index];
    if (message && message.role === "assistant" && message.content.trim() !== "") {
      return message.content;
    }
  }
  const last = normalized.at(-1);
  return last?.content ?? "";
}

export function adaptDeepAgent(agent: DeepAgent): OrchestratedDeepAgent {
  return {
    invoke: async (input) => {
      const result = (await agent.invoke({
        messages: input.messages,
      } as Parameters<typeof agent.invoke>[0])) as OrchestratedDeepAgentInvokeOutput & {
        messages?: unknown;
      };
      return { messages: normalizeMessages(result?.messages) };
    },
  };
}
