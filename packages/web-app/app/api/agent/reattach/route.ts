import { NextResponse } from "next/server";

import type { AgentExecutor } from "../../../../src/server/agent-runtime/types.ts";
import { applyGuestCookie, resolveGuestIdentity } from "../../../../src/server/guest-identity.ts";
import { __getExecutorForCancellation } from "../route.ts";

const encoder = new TextEncoder();

function parseRequestBody(body: unknown): {
  afterEventId: string;
  runId: string;
  sessionId: string;
} {
  if (typeof body !== "object" || body === null) throw new Error("Request body must be an object.");
  const { afterEventId, runId, sessionId } = body as Record<string, unknown>;
  if (typeof sessionId !== "string" || !sessionId.trim()) throw new Error("sessionId is required.");
  if (typeof runId !== "string" || !runId.trim()) throw new Error("runId is required.");
  if (typeof afterEventId !== "string" || !afterEventId.trim()) {
    throw new Error("afterEventId is required.");
  }
  return { afterEventId: afterEventId.trim(), runId: runId.trim(), sessionId: sessionId.trim() };
}

export function createAgentReattachHandler(
  executor: AgentExecutor,
): (request: Request) => Promise<Response> {
  return async (request) => {
    let body: { afterEventId: string; runId: string; sessionId: string };
    try {
      body = parseRequestBody(await request.json());
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 400 },
      );
    }

    let guestIdentity: ReturnType<typeof resolveGuestIdentity>;
    try {
      guestIdentity = resolveGuestIdentity(request);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 500 },
      );
    }

    const handle = await executor.reattach(
      guestIdentity.identity,
      body.sessionId,
      body.runId,
      body.afterEventId,
    );
    if (!handle) {
      return applyGuestCookie(
        NextResponse.json({ error: "Run not found." }, { status: 404 }),
        guestIdentity.setCookie,
      );
    }

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const event of handle.events) {
            if (event.kind === "ui")
              controller.enqueue(
                encoder.encode(
                  `${JSON.stringify(
                    event.eventId
                      ? { eventId: event.eventId, update: event.update }
                      : { update: event.update },
                  )}\n`,
                ),
              );
          }
        } catch {
          // The client may close its transport while the worker continues.
        } finally {
          try {
            controller.close();
          } catch {
            // Already closed.
          }
        }
      },
    });
    return applyGuestCookie(
      new Response(stream, {
        headers: {
          "Cache-Control": "no-cache, no-transform",
          "Content-Type": "application/x-ndjson; charset=utf-8",
        },
      }),
      guestIdentity.setCookie,
    );
  };
}

export async function POST(request: Request): Promise<Response> {
  return createAgentReattachHandler(await __getExecutorForCancellation())(request);
}
