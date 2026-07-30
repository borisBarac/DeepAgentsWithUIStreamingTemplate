import { NextResponse } from "next/server";

import type { AgentExecutor } from "../../../../src/server/agent-runtime/types.ts";
import { __getExecutorForCancellation } from "../route.ts";

function parseRunId(body: unknown): string {
  if (typeof body !== "object" || body === null) throw new Error("Request body must be an object.");
  const { runId } = body as Record<string, unknown>;
  if (typeof runId !== "string" || !runId.trim()) throw new Error("runId is required.");
  return runId.trim();
}

export function createAgentCancellationHandler(
  executor: AgentExecutor,
): (request: Request) => Promise<Response> {
  return async (request) => {
    let runId: string;
    try {
      runId = parseRunId(await request.json());
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 400 },
      );
    }
    const result = await executor.cancel(runId);
    const status = result.status === "unknown" ? 404 : result.status === "terminal" ? 409 : 202;
    return NextResponse.json(result, { status });
  };
}

export async function POST(request: Request): Promise<Response> {
  return createAgentCancellationHandler(await __getExecutorForCancellation())(request);
}
