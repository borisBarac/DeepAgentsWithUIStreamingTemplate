import type { DeepAgent } from "@deep-agent-template/core";
import {
  extractUpdateObjects,
  normalizeUiUpdate,
  StreamingLineBuffer,
  type UiUpdate,
} from "@deep-agent-template/core/generative-ui";
import { NextResponse } from "next/server";

import { createAgentProvider } from "../../../src/server/agent-provider.ts";
import { normalizeStreamingSpec } from "../../../src/ui/normalize.ts";

export const runtime = "nodejs";

type AgentInputMessage = {
  content: string;
  role: "assistant" | "user";
};

type AgentResult = {
  messages?: unknown[];
};

type Agent = DeepAgent;

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
const sessions = new Map<string, unknown[]>();

function getHistory(sessionId: string): unknown[] {
  const history = sessions.get(sessionId);
  if (!history) {
    return [];
  }
  sessions.delete(sessionId);
  sessions.set(sessionId, history);
  return history;
}

function saveHistory(sessionId: string, history: unknown[]): void {
  sessions.delete(sessionId);
  sessions.set(sessionId, history);
  while (sessions.size > MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    if (oldest === undefined) break;
    sessions.delete(oldest);
  }
}

function createAgent(): Agent {
  return createAgentProvider().agent;
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

function toInputMessages(history: unknown[], message: string): unknown[] {
  return [...history, { content: message, role: "user" }];
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
  onUpdate?: (update: UiUpdate) => void,
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
        onUpdate?.(update);
      }
    }
  }
}

async function streamWithEvents(
  agent: StreamableAgent,
  input: { messages: AgentInputMessage[] },
  sessionId: string,
  onText: (text: string) => void,
): Promise<{ finalText: string; result: AgentResult | null; streamedText: boolean }> {
  if (!agent.streamEvents) {
    const result = (await agent.invoke(input)) as AgentResult;
    return { finalText: extractFinalResponse(result), result, streamedText: false };
  }

  const run = await agent.streamEvents(input, {
    configurable: { thread_id: sessionId },
    version: "v3",
  });
  let streamedText = "";

  for await (const message of run.messages) {
    for await (const token of message.text) {
      streamedText += token;
      onText(token);
    }
  }

  const result = await run.output;
  const finalText = streamedText || extractFinalResponse(result);
  return { finalText, result, streamedText: Boolean(streamedText) };
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
      const input = {
        messages: toInputMessages(history, parsedRequest.message),
      } as { messages: AgentInputMessage[] };
      const agent = getAgent() as StreamableAgent;
      const stats = { valid: 0 };

      async function runAttempt(): Promise<{ finalText: string; result: AgentResult | null }> {
        const lineBuffer = new StreamingLineBuffer();
        const { finalText, result, streamedText } = await streamWithEvents(
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
        return { finalText, result };
      }

      try {
        let attempt = await runAttempt();

        // If the model ignored the NDJSON prompt entirely (zero valid updates),
        // retry once — it often cooperates on the second attempt.
        if (stats.valid === 0) {
          attempt = await runAttempt();
        }

        if (stats.valid === 0) {
          controller.enqueue(
            encodeUpdate({
              type: "error",
              message: "The model did not produce any valid UI updates.",
            }),
          );
        }

        const outputMessages = attempt.result?.messages;
        if (Array.isArray(outputMessages) && outputMessages.length > 0) {
          saveHistory(parsedRequest.sessionId, outputMessages);
        } else {
          saveHistory(parsedRequest.sessionId, [
            ...history,
            { content: parsedRequest.message, role: "user" },
            { content: attempt.finalText, role: "assistant" },
          ]);
        }
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
