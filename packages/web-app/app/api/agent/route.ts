import type { DeepAgent } from "@deep-agent-template/core";
import {
  normalizeUiUpdate,
  parseUpdateText,
  productCardBatchSchema,
  productCardsToUiUpdates,
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

type StreamTextMessage = {
  text: AsyncIterable<string>;
};

type StreamSubagent = {
  name?: unknown;
  subagentName?: unknown;
  taskInput?: unknown;
  messages?: AsyncIterable<StreamTextMessage>;
  output?: Promise<unknown>;
};

type StreamableAgent = Agent & {
  streamEvents?: (
    input: { messages: AgentInputMessage[] },
    config: { configurable: { thread_id: string }; version: "v3" },
  ) => Promise<{
    messages: AsyncIterable<StreamTextMessage>;
    subagents?: AsyncIterable<StreamSubagent>;
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

export function setAgentForTest(agent: Agent | null): void {
  agentCache = agent;
}

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
    return "";
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

  return "";
}

function toInputMessages(history: unknown[], message: string): unknown[] {
  return [...history, { content: message, role: "user" }];
}

const encoder = new TextEncoder();

function encodeUpdate(update: UiUpdate): Uint8Array {
  return encoder.encode(`${JSON.stringify(update)}\n`);
}

function parseRequestBody(body: unknown): {
  includeSubagentActivity: boolean;
  message: string;
  sessionId: string;
} {
  if (typeof body !== "object" || body === null) {
    throw new Error("Request body must be an object.");
  }

  const { includeSubagentActivity, message, sessionId } = body as Record<string, unknown>;
  if (typeof sessionId !== "string" || !sessionId.trim()) {
    throw new Error("sessionId is required.");
  }
  if (typeof message !== "string" || !message.trim()) {
    throw new Error("message is required.");
  }

  return {
    includeSubagentActivity: includeSubagentActivity === true,
    sessionId: sessionId.trim(),
    message: message.trim(),
  };
}

function emitParsedUpdates(
  controller: ReadableStreamDefaultController<Uint8Array>,
  updates: UiUpdate[],
  stats?: { valid: number },
  onUpdate?: (update: UiUpdate) => void,
): void {
  for (const update of updates) {
    controller.enqueue(encodeUpdate(update));
    if (stats) stats.valid += 1;
    onUpdate?.(update);
  }
}

export function productBatchTextToUiUpdates(text: string): UiUpdate[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }

  const batch = productCardBatchSchema.safeParse(parsed);
  if (!batch.success) {
    return [];
  }

  return productCardsToUiUpdates(batch.data.products).flatMap((candidate) => {
    const update = normalizeUiUpdate(candidate, normalizeStreamingSpec);
    return update ? [update] : [];
  });
}

function emitProductBatchFallback(
  controller: ReadableStreamDefaultController<Uint8Array>,
  finalText: string,
  stats: { valid: number },
): boolean {
  const updates = productBatchTextToUiUpdates(finalText);
  for (const update of updates) {
    controller.enqueue(encodeUpdate(update));
    stats.valid += 1;
  }
  return updates.length > 0;
}

const UNRENDERABLE_UI_MESSAGE =
  "I could not render that as an interactive UI, but I can try again with a simpler product-card layout.";

export function finalTextToMessageFallback(finalText: string): UiUpdate {
  return {
    type: "message",
    text: finalTextToAssistantContent(finalText),
  };
}

function finalTextToAssistantContent(finalText: string): string {
  const text = finalText.trim();
  return text || UNRENDERABLE_UI_MESSAGE;
}

function emitMessageFallback(
  controller: ReadableStreamDefaultController<Uint8Array>,
  finalText: string,
  stats: { valid: number },
): void {
  controller.enqueue(encodeUpdate(finalTextToMessageFallback(finalText)));
  stats.valid += 1;
}

async function streamWithEvents(
  agent: StreamableAgent,
  input: { messages: AgentInputMessage[] },
  sessionId: string,
  onMainAgentActivity?: (update: Extract<UiUpdate, { type: "main_agent_activity" }>) => void,
  onSubagentActivity?: (update: Extract<UiUpdate, { type: "subagent_activity" }>) => void,
): Promise<{ finalText: string; result: AgentResult | null }> {
  if (!agent.streamEvents) {
    const result = (await agent.invoke(input)) as AgentResult;
    return { finalText: extractFinalResponse(result), result };
  }

  const run = await agent.streamEvents(input, {
    configurable: { thread_id: sessionId },
    version: "v3",
  });
  let streamedText = "";

  const drainMessages = async () => {
    onMainAgentActivity?.({ type: "main_agent_activity", event: "started" });
    for await (const message of run.messages) {
      for await (const token of message.text) {
        if (!token) {
          continue;
        }
        streamedText += token;
        onMainAgentActivity?.({ type: "main_agent_activity", event: "delta", text: token });
      }
    }
  };

  const drainSubagents = async () => {
    if (!run.subagents || !onSubagentActivity) {
      return;
    }

    const activityStreams: Promise<void>[] = [];
    for await (const subagent of run.subagents) {
      activityStreams.push(drainSubagentActivity(subagent, onSubagentActivity));
    }
    await Promise.all(activityStreams);
  };

  try {
    const [result] = await Promise.all([run.output, drainMessages(), drainSubagents()]);
    onMainAgentActivity?.({ type: "main_agent_activity", event: "completed" });
    const finalText = streamedText || extractFinalResponse(result);
    return { finalText, result };
  } catch (error) {
    onMainAgentActivity?.({
      type: "main_agent_activity",
      event: "error",
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function drainSubagentActivity(
  subagent: StreamSubagent,
  onSubagentActivity: (update: Extract<UiUpdate, { type: "subagent_activity" }>) => void,
): Promise<void> {
  const subagentName = subagentNameFrom(subagent);
  const subagentRunId = crypto.randomUUID();
  try {
    onSubagentActivity({
      type: "subagent_activity",
      subagentRunId,
      subagentName,
      event: "started",
      task: taskInputToText(subagent.taskInput),
    });

    if (subagent.messages) {
      for await (const message of subagent.messages) {
        for await (const token of message.text) {
          if (token) {
            onSubagentActivity({
              type: "subagent_activity",
              subagentRunId,
              subagentName,
              event: "delta",
              text: token,
            });
          }
        }
      }
    }

    await subagent.output;
    onSubagentActivity({
      type: "subagent_activity",
      subagentRunId,
      subagentName,
      event: "completed",
    });
  } catch (error) {
    onSubagentActivity({
      type: "subagent_activity",
      subagentRunId,
      subagentName,
      event: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function subagentNameFrom(subagent: StreamSubagent): string {
  if (typeof subagent.subagentName === "string" && subagent.subagentName.trim()) {
    return subagent.subagentName.trim();
  }
  if (typeof subagent.name === "string" && subagent.name.trim()) {
    return subagent.name.trim();
  }
  return "subagent";
}

function taskInputToText(taskInput: unknown): string | undefined {
  if (typeof taskInput === "string") {
    return taskInput.trim() || undefined;
  }
  if (typeof taskInput !== "object" || taskInput === null) {
    return undefined;
  }

  if ("task" in taskInput && typeof taskInput.task === "string") {
    return taskInput.task.trim() || undefined;
  }
  if ("content" in taskInput) {
    return extractTextContent(taskInput.content);
  }
  return undefined;
}

export async function POST(request: Request): Promise<Response> {
  let parsedRequest: { includeSubagentActivity: boolean; message: string; sessionId: string };
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
        const { finalText, result } = await streamWithEvents(
          agent,
          input,
          parsedRequest.sessionId,
          parsedRequest.includeSubagentActivity
            ? (update) => {
                controller.enqueue(encodeUpdate(update));
              }
            : undefined,
          parsedRequest.includeSubagentActivity
            ? (update) => {
                controller.enqueue(encodeUpdate(update));
              }
            : undefined,
        );

        emitParsedUpdates(controller, parseUpdateText(finalText, normalizeStreamingSpec), stats);
        return { finalText, result };
      }

      try {
        let attempt = await runAttempt();

        // If the model ignored the NDJSON prompt entirely (zero valid updates),
        // first bridge known structured product-generator output, then retry
        // once for other malformed output.
        if (stats.valid === 0) {
          emitProductBatchFallback(controller, attempt.finalText, stats);
        }

        if (stats.valid === 0) {
          attempt = await runAttempt();
          emitProductBatchFallback(controller, attempt.finalText, stats);
        }

        if (stats.valid === 0) {
          emitMessageFallback(controller, attempt.finalText, stats);
        }

        const outputMessages = attempt.result?.messages;
        if (Array.isArray(outputMessages) && outputMessages.length > 0) {
          saveHistory(parsedRequest.sessionId, outputMessages);
        } else {
          saveHistory(parsedRequest.sessionId, [
            ...history,
            { content: parsedRequest.message, role: "user" },
            { content: finalTextToAssistantContent(attempt.finalText), role: "assistant" },
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
