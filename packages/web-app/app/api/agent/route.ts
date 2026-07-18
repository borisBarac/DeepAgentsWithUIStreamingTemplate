import {
  type AgentInputMessage,
  createInteractionStream,
  type InteractionStreamFailure,
  type ModelUiOutput,
  type StreamableAgent,
  type UiUpdate,
} from "@deep-agent-template/core/interaction-stream";
import { NextResponse } from "next/server";

import { createAgentProvider } from "../../../src/server/agent-provider.ts";
import { normalizeStreamingSpec, validateStreamingSpec } from "../../../src/ui/normalize.ts";

export const runtime = "nodejs";

type Agent = StreamableAgent;

const MAX_SESSIONS = 100;
type SessionState = {
  failure: InteractionStreamFailure | null;
  history: unknown[];
  structuredOutput: ModelUiOutput | null;
};

const sessions = new Map<string, SessionState>();

function getHistory(sessionId: string): unknown[] {
  const history = sessions.get(sessionId);
  if (!history) {
    return [];
  }
  sessions.delete(sessionId);
  sessions.set(sessionId, history);
  return history.history;
}

function saveSession(sessionId: string, state: SessionState): void {
  sessions.delete(sessionId);
  sessions.set(sessionId, state);
  while (sessions.size > MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    if (oldest === undefined) break;
    sessions.delete(oldest);
  }
}

export function getSessionStateForTest(sessionId: string): SessionState | null {
  return sessions.get(sessionId) ?? null;
}

type AgentFactory = () => Promise<Agent>;

let agentFactory: AgentFactory = createAgentProvider;
let agentInitialization: Promise<Agent> | null = null;

export function setAgentForTest(agent: Agent | null): void {
  agentInitialization = agent === null ? null : Promise.resolve(agent);
}

export function setAgentFactoryForTest(factory: AgentFactory | null): void {
  agentFactory = factory ?? createAgentProvider;
  agentInitialization = null;
}

function getAgent(): Promise<Agent> {
  if (agentInitialization === null) {
    const initialization = agentFactory();
    agentInitialization = initialization;
    void initialization.catch(() => {
      if (agentInitialization === initialization) {
        agentInitialization = null;
      }
    });
  }
  return agentInitialization;
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
      try {
        const agent = await getAgent();
        const interaction = createInteractionStream({
          agent,
          includeActivity: parsedRequest.includeSubagentActivity,
          messages,
          normalizeSpec: normalizeStreamingSpec,
          requireStructuredOutput: true,
          validateSpec: validateStreamingSpec,
          sessionId: parsedRequest.sessionId,
        });
        void interaction.result.catch(() => undefined);

        for await (const update of interaction.updates) {
          controller.enqueue(encodeUpdate(update));
        }

        const result = await interaction.result;
        saveSession(parsedRequest.sessionId, {
          failure: result.failure,
          history: result.history,
          structuredOutput: result.structuredOutput,
        });
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
