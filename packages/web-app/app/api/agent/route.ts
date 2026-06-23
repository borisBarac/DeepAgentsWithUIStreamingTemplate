import { createBaselineAgent } from "@deep-agent-template/core/agent/baseline";
import {
  extractUpdateObjects,
  normalizeUiUpdate,
  StreamingLineBuffer,
  type UiUpdate,
} from "@deep-agent-template/core/generative-ui";
import { createModelRuntime } from "@deep-agent-template/core/models";
import { NextResponse } from "next/server";

import { normalizeStreamingSpec } from "../../../src/ui/normalize.ts";
import { catalogPrompt } from "../../../src/ui/schema.ts";
import type { ChatMessage } from "../../../src/ui/types.ts";

export const runtime = "nodejs";

type AgentInputMessage = {
  content: string;
  role: "assistant" | "user";
};

type AgentResult = {
  messages?: unknown[];
};

type Agent = ReturnType<typeof createBaselineAgent>;

type StreamableAgent = Agent & {
  streamEvents?: (
    input: { messages: AgentInputMessage[] },
    config: { configurable: { thread_id: string }; version: "v3" },
  ) => Promise<{
    messages: AsyncIterable<{
      text: AsyncIterable<string>;
    }>;
    output: Promise<AgentResult>;
  }>;
};

const MAX_SESSIONS = 100;
const sessions = new Map<string, ChatMessage[]>();

function getHistory(sessionId: string): ChatMessage[] {
  const history = sessions.get(sessionId);
  if (!history) {
    return [];
  }
  sessions.delete(sessionId);
  sessions.set(sessionId, history);
  return history;
}

function saveHistory(sessionId: string, history: ChatMessage[]): void {
  sessions.delete(sessionId);
  sessions.set(sessionId, history);
  while (sessions.size > MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    if (oldest === undefined) break;
    sessions.delete(oldest);
  }
}

function createAgent(): Agent {
  const baseURL = process.env.LLM_BASE_URL?.trim();
  const apiKey = process.env.LLM_API_KEY?.trim();
  const model = process.env.LLM_MODEL?.trim() || "deepseek-v4-flash";

  if (!baseURL) {
    throw new Error("LLM_BASE_URL is required.");
  }
  if (!apiKey) {
    throw new Error("LLM_API_KEY is required.");
  }

  const modelRuntime = createModelRuntime({
    connections: {
      default: { provider: "openai-compatible", apiKey, baseURL },
    },
    models: {
      // Model emits raw NDJSON (one UiUpdate per line); no response_format
      // constraint needed. See packages/core/src/generative-ui/prompt.ts.
      default: { connection: "default", model },
    },
    assignments: { default: "default" },
  });

  return createBaselineAgent({
    guardrails: false,
    generativeUi: { catalogPrompt },
    modelRuntime,
    tools: [],
  });
}

let agentCache: Agent | null = null;

function getAgent(): Agent {
  if (agentCache === null) {
    agentCache = createAgent();
  }
  return agentCache;
}

function extractTextContent(content: unknown): string | undefined {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return undefined;
  }

  const text = content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }
      if (typeof part === "object" && part !== null && "text" in part) {
        return typeof part.text === "string" ? part.text : "";
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");

  return text || undefined;
}

function extractFinalResponse(result: AgentResult): string {
  const messages = result.messages;
  if (!Array.isArray(messages)) {
    throw new Error("Core returned no messages.");
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (typeof message !== "object" || message === null || !("content" in message)) {
      continue;
    }

    const content = extractTextContent(message.content);
    if (content) {
      return content;
    }
  }

  throw new Error("Core returned no text response.");
}

function toInputMessages(history: ChatMessage[], message: string): AgentInputMessage[] {
  return [...history, { role: "user", content: message }];
}

const encoder = new TextEncoder();

function encodeUpdate(update: UiUpdate): Uint8Array {
  return encoder.encode(`${JSON.stringify(update)}\n`);
}

function parseRequestBody(body: unknown): { message: string; sessionId: string } {
  if (typeof body !== "object" || body === null) {
    throw new Error("Request body must be an object.");
  }

  const { message, sessionId } = body as Record<string, unknown>;
  if (typeof sessionId !== "string" || !sessionId.trim()) {
    throw new Error("sessionId is required.");
  }
  if (typeof message !== "string" || !message.trim()) {
    throw new Error("message is required.");
  }

  return { sessionId: sessionId.trim(), message: message.trim() };
}

function emitParsedLines(
  controller: ReadableStreamDefaultController<Uint8Array>,
  lines: string[],
  stats?: { valid: number },
): void {
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    for (const candidate of extractUpdateObjects(parsed)) {
      const update = normalizeUiUpdate(candidate, normalizeStreamingSpec);
      if (update) {
        controller.enqueue(encodeUpdate(update));
        if (stats) stats.valid += 1;
      }
    }
  }
}

async function streamWithEvents(
  agent: StreamableAgent,
  input: { messages: AgentInputMessage[] },
  sessionId: string,
  onText: (text: string) => void,
): Promise<{ finalText: string; streamedText: boolean }> {
  if (!agent.streamEvents) {
    const result = await agent.invoke(input);
    return { finalText: extractFinalResponse(result as AgentResult), streamedText: false };
  }

  const run = await agent.streamEvents(input, {
    configurable: { thread_id: sessionId },
    version: "v3",
  });
  let finalText = "";

  for await (const message of run.messages) {
    for await (const token of message.text) {
      finalText += token;
      onText(token);
    }
  }

  if (finalText) {
    return { finalText, streamedText: true };
  }

  return { finalText: extractFinalResponse(await run.output), streamedText: false };
}

export async function POST(request: Request): Promise<Response> {
  let parsedRequest: { message: string; sessionId: string };
  try {
    parsedRequest = parseRequestBody(await request.json());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const history = getHistory(parsedRequest.sessionId);
      const input = { messages: toInputMessages(history, parsedRequest.message) };
      const agent = getAgent() as StreamableAgent;
      const stats = { valid: 0 };

      async function runAttempt(): Promise<string> {
        const lineBuffer = new StreamingLineBuffer();
        const { finalText, streamedText } = await streamWithEvents(
          agent,
          input,
          parsedRequest.sessionId,
          (token) => {
            emitParsedLines(controller, lineBuffer.push(token), stats);
          },
        );

        if (streamedText) {
          // The final line often lacks a trailing newline; flush whatever
          // remains buffered so it isn't dropped.
          emitParsedLines(controller, lineBuffer.flush(), stats);
        } else {
          emitParsedLines(controller, finalText.split("\n"), stats);
        }
        return finalText;
      }

      try {
        let finalText = await runAttempt();

        // If the model ignored the NDJSON prompt entirely (zero valid updates),
        // retry once — it often cooperates on the second attempt.
        if (stats.valid === 0) {
          finalText = await runAttempt();
        }

        if (stats.valid === 0) {
          controller.enqueue(
            encodeUpdate({
              type: "error",
              message: "The model did not produce any valid UI updates.",
            }),
          );
        }

        saveHistory(parsedRequest.sessionId, [
          ...history,
          { role: "user", content: parsedRequest.message },
          { role: "assistant", content: finalText },
        ]);
      } catch (error) {
        controller.enqueue(
          encodeUpdate({
            type: "error",
            message: error instanceof Error ? error.message : String(error),
          }),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      "Content-Type": "application/x-ndjson; charset=utf-8",
    },
  });
}
