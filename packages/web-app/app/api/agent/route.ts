import { createBaselineAgent } from "@deep-agent-template/core/agent/baseline";
import { createModelRuntime } from "@deep-agent-template/core/models";
import { DEFAULT_PROMPT_LOADER, type PromptLoader } from "@deep-agent-template/core/prompts";
import { NextResponse } from "next/server";

import {
  extractEnvelopeUpdates,
  UiUpdateScanner,
} from "../../../src/streaming/ui-update-scanner.ts";
import { catalogPrompt } from "../../../src/ui/schema.ts";
import type { ChatMessage, UiUpdate } from "../../../src/ui/types.ts";
import { normalizeUiUpdate } from "../../../src/ui/updates.ts";

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

const sessions = new Map<string, ChatMessage[]>();

const uiPromptLoader: PromptLoader = {
  getAnalystPrompt: () => DEFAULT_PROMPT_LOADER.getAnalystPrompt(),
  getBaselinePrompt: () => `${DEFAULT_PROMPT_LOADER.getBaselinePrompt()}\n\n${catalogPrompt}`,
  getClarifierPrompt: (config) => DEFAULT_PROMPT_LOADER.getClarifierPrompt(config),
  getImageDesignerPrompt: () => DEFAULT_PROMPT_LOADER.getImageDesignerPrompt(),
  getResearcherPrompt: () => DEFAULT_PROMPT_LOADER.getResearcherPrompt(),
  getReviewAgentPrompt: () => DEFAULT_PROMPT_LOADER.getReviewAgentPrompt(),
  getSupervisorPrompt: (config) => DEFAULT_PROMPT_LOADER.getSupervisorPrompt(config),
};

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
      default: {
        connection: "default",
        model,
        providerOptions: {
          responseFormat: { type: "json_object" },
        },
      },
    },
    assignments: { default: "default" },
  });

  const options = {
    guardrails: false,
    modelRuntime,
    promptLoader: uiPromptLoader,
    tools: [],
  } as const;

  return createBaselineAgent(options);
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

function encodeUpdate(update: UiUpdate): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(update)}\n`);
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

function emitParsedUpdates(
  controller: ReadableStreamDefaultController<Uint8Array>,
  rawUpdates: unknown[],
): void {
  for (const rawUpdate of rawUpdates) {
    const update = normalizeUiUpdate(rawUpdate);
    if (update) {
      controller.enqueue(encodeUpdate(update));
    } else {
      controller.enqueue(encodeUpdate({ type: "error", message: "Ignored invalid UI update." }));
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
      const scanner = new UiUpdateScanner();
      const history = sessions.get(parsedRequest.sessionId) ?? [];
      const input = { messages: toInputMessages(history, parsedRequest.message) };

      try {
        const agent = createAgent() as StreamableAgent;
        const { finalText, streamedText } = await streamWithEvents(
          agent,
          input,
          parsedRequest.sessionId,
          (token) => {
            emitParsedUpdates(controller, scanner.push(token));
          },
        );

        if (!streamedText) {
          emitParsedUpdates(controller, extractEnvelopeUpdates(finalText));
        }
        sessions.set(parsedRequest.sessionId, [
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
