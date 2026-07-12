import {
  type AgentInputMessage,
  createInteractionStream,
  type StreamableAgent,
  type UiUpdate,
} from "@deep-agent-template/core/interaction-stream";
import { NextResponse } from "next/server";

import { createAgentProvider } from "../../../src/server/agent-provider.ts";
import { normalizeStreamingSpec, validateStreamingSpec } from "../../../src/ui/normalize.ts";

export const runtime = "nodejs";

type Agent = StreamableAgent;

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
  return createAgentProvider();
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

function toInputMessages(history: unknown[], message: string): AgentInputMessage[] {
  return [...(history as AgentInputMessage[]), { content: message, role: "user" }];
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
      const messages = toInputMessages(history, parsedRequest.message);
      const agent = getAgent();

      try {
        const interaction = createInteractionStream({
          agent,
          includeActivity: parsedRequest.includeSubagentActivity,
          messages,
          normalizeSpec: normalizeStreamingSpec,
          validateSpec: validateStreamingSpec,
          sessionId: parsedRequest.sessionId,
        });
        void interaction.result.catch(() => undefined);

        for await (const update of interaction.updates) {
          controller.enqueue(encodeUpdate(update));
        }

        const result = await interaction.result;
        saveHistory(parsedRequest.sessionId, result.history);
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
