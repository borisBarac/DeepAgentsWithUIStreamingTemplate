import { NextResponse } from "next/server";

import { injectTraceContext } from "../../../src/server/agent-runtime/telemetry.ts";
import type {
  AgentExecutionHandle,
  AgentExecutor,
  ExecutionEvent,
  ExecutionRequest,
} from "../../../src/server/agent-runtime/types.ts";
import { applyGuestCookie, resolveGuestIdentity } from "../../../src/server/guest-identity.ts";
import {
  buildBullMqAgentExecutor,
  isSessionBusyError,
} from "../../../src/server/worker/bullmq-executor.ts";

export const runtime = "nodejs";

const encoder = new TextEncoder();

type UiEvent = Extract<ExecutionEvent, { readonly kind: "ui" }>;

function encodeUpdate(event: UiEvent): Uint8Array {
  const frame = event.eventId
    ? { eventId: event.eventId, update: event.update }
    : { update: event.update };
  return encoder.encode(`${JSON.stringify(frame)}\n`);
}

function parseRequestBody(body: unknown): {
  includeSubagentActivity: boolean;
  message: string;
  runId: string;
  sessionId: string;
} {
  if (typeof body !== "object" || body === null) {
    throw new Error("Request body must be an object.");
  }

  const { includeSubagentActivity, message, runId, sessionId } = body as Record<string, unknown>;
  if (typeof sessionId !== "string" || !sessionId.trim()) {
    throw new Error("sessionId is required.");
  }
  if (typeof message !== "string" || !message.trim()) {
    throw new Error("message is required.");
  }
  if (typeof runId !== "string" || !runId.trim()) {
    throw new Error("runId is required.");
  }

  return {
    includeSubagentActivity: includeSubagentActivity === true,
    sessionId: sessionId.trim(),
    message: message.trim(),
    runId: runId.trim(),
  };
}

export function createAgentRequestHandler(
  executor: AgentExecutor,
): (request: Request) => Promise<Response> {
  return async function handleAgentRequest(request: Request): Promise<Response> {
    let parsedRequest: {
      includeSubagentActivity: boolean;
      message: string;
      runId: string;
      sessionId: string;
    };
    try {
      parsedRequest = parseRequestBody(await request.json());
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 400 },
      );
    }

    const abortController = new AbortController();
    let guestIdentity: ReturnType<typeof resolveGuestIdentity>;
    try {
      guestIdentity = resolveGuestIdentity(request);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 500 },
      );
    }
    const messages: ExecutionRequest["messages"] = [
      { content: parsedRequest.message, role: "user" },
    ];

    let handle: AgentExecutionHandle;
    try {
      handle = await executor.execute(
        {
          identity: guestIdentity.identity,
          messages,
          options: {
            includeActivity: parsedRequest.includeSubagentActivity,
            requireStructuredOutput: true,
          },
          runId: parsedRequest.runId,
          sessionId: parsedRequest.sessionId,
          traceContext: injectTraceContext(),
        },
        abortController.signal,
      );
    } catch (error) {
      if (isSessionBusyError(error)) {
        return applyGuestCookie(
          NextResponse.json(
            { error: "Session is busy.", activeRunId: error.activeRunId },
            { status: 409 },
          ),
          guestIdentity.setCookie,
        );
      }
      return applyGuestCookie(
        NextResponse.json(
          { error: error instanceof Error ? error.message : String(error) },
          { status: 500 },
        ),
        guestIdentity.setCookie,
      );
    }

    return applyGuestCookie(streamEvents(handle.events), guestIdentity.setCookie);
  };
}

let cachedExecutor: AgentExecutor | null = null;

async function getProductionExecutor(): Promise<AgentExecutor> {
  if (cachedExecutor) return cachedExecutor;
  const prefix = (process.env.REDIS_KEY_PREFIX ?? "dat:").trim();
  const { getSharedRedis, getBullMqRedis } = await import("../../../src/server/redis/client.ts");
  const [client, bullMqClient] = await Promise.all([getSharedRedis(), getBullMqRedis()]);
  cachedExecutor = buildBullMqAgentExecutor({ bullMqClient, client, keyPrefix: prefix });
  return cachedExecutor;
}

export async function __getExecutorForCancellation(): Promise<AgentExecutor> {
  return getProductionExecutor();
}

export function __setExecutorForTest(executor: AgentExecutor | null): void {
  cachedExecutor = executor;
}

export async function POST(request: Request): Promise<Response> {
  return createAgentRequestHandler(await getProductionExecutor())(request);
}

function streamUiUpdates(updates: AsyncIterable<UiEvent>): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const update of updates) {
          controller.enqueue(encodeUpdate(update));
        }
      } catch {
        // Controller was closed/errored (e.g. client disconnect).
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed by cancellation.
        }
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

async function* filterUiUpdates(events: AsyncIterable<ExecutionEvent>): AsyncIterable<UiEvent> {
  for await (const event of events) {
    if (event.kind === "ui") yield event;
  }
}

function streamEvents(events: AsyncIterable<ExecutionEvent>): Response {
  return streamUiUpdates(filterUiUpdates(events));
}
