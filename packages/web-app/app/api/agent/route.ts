import { randomUUID } from "node:crypto";

import type { UiUpdate } from "@deep-agent-template/core/interaction-stream";
import { NextResponse } from "next/server";

import { injectTraceContext } from "../../../src/server/agent-runtime/telemetry.ts";
import type {
  AgentExecutionHandle,
  AgentExecutor,
  ExecutionEvent,
  ExecutionRequest,
} from "../../../src/server/agent-runtime/types.ts";
import { resolveGuestIdentity } from "../../../src/server/identity.ts";
import {
  buildBullMqAgentExecutor,
  isSessionBusyError,
} from "../../../src/server/worker/bullmq-executor.ts";

export const runtime = "nodejs";

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

// Factory: build a request handler backed by an injected AgentExecutor.
// Production passes the lazily-cached BullMQ executor; route tests pass a fake
// that emits controlled ExecutionEvent streams. The handler owns request
// validation, execution-request mapping, session-busy/generic error mapping,
// and the NDJSON streaming response.
export function createAgentRequestHandler(
  executor: AgentExecutor,
): (request: Request) => Promise<Response> {
  return async function handleAgentRequest(request: Request): Promise<Response> {
    let parsedRequest: { includeSubagentActivity: boolean; message: string; sessionId: string };
    try {
      parsedRequest = parseRequestBody(await request.json());
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 400 },
      );
    }

    let identity: { tenantId: string; userId: string };
    try {
      identity = resolveGuestIdentity(request);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 400 },
      );
    }

    const abortController = new AbortController();
    const runId = randomUUID();
    const messages: ExecutionRequest["messages"] = [
      { content: parsedRequest.message, role: "user" },
    ];

    let handle: AgentExecutionHandle;
    try {
      handle = await executor.execute(
        {
          identity,
          messages,
          options: {
            includeActivity: parsedRequest.includeSubagentActivity,
            requireStructuredOutput: true,
          },
          runId,
          sessionId: parsedRequest.sessionId,
          traceContext: injectTraceContext(),
        },
        abortController.signal,
      );
    } catch (error) {
      if (isSessionBusyError(error)) {
        return NextResponse.json(
          { error: "Session is busy.", activeRunId: error.activeRunId },
          { status: 409 },
        );
      }
      return NextResponse.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 500 },
      );
    }

    return streamEvents(handle.events, abortController);
  };
}

// Production always uses BullMQ + Redis Streams. The executor is built once and
// cached for the lifetime of the process.
let cachedExecutor: AgentExecutor | null = null;

async function getProductionExecutor(): Promise<AgentExecutor> {
  if (cachedExecutor) return cachedExecutor;
  const prefix = (process.env.REDIS_KEY_PREFIX ?? "dat:").trim();
  const { getSharedRedis, getBullMqRedis } = await import("../../../src/server/redis/client.ts");
  const [client, bullMqClient] = await Promise.all([getSharedRedis(), getBullMqRedis()]);
  cachedExecutor = buildBullMqAgentExecutor({ bullMqClient, client, keyPrefix: prefix });
  return cachedExecutor;
}

export async function POST(request: Request): Promise<Response> {
  return createAgentRequestHandler(await getProductionExecutor())(request);
}

function streamUiUpdates(
  updates: AsyncIterable<UiUpdate>,
  abortController: AbortController,
): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const update of updates) {
          controller.enqueue(encodeUpdate(update));
        }
      } catch {
        // Controller was closed/errored (e.g. client disconnect). The
        // runner owns error-to-UI translation; nothing more to emit.
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed by cancellation.
        }
      }
    },
    cancel() {
      abortController.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      "Content-Type": "application/x-ndjson; charset=utf-8",
    },
  });
}

// Events arrive as ExecutionEvent (ui/lifecycle/result). Filter to UI updates
// only — lifecycle and result are server-only and never sent on the wire
// (preserves the NDJSON client contract).
async function* filterUiUpdates(events: AsyncIterable<ExecutionEvent>): AsyncIterable<UiUpdate> {
  for await (const event of events) {
    if (event.kind === "ui") yield event.update;
  }
}

function streamEvents(
  events: AsyncIterable<ExecutionEvent>,
  abortController: AbortController,
): Response {
  return streamUiUpdates(filterUiUpdates(events), abortController);
}
