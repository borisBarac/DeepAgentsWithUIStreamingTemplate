import type { StreamableAgent, UiUpdate } from "@deep-agent-template/core/interaction-stream";
import { NextResponse } from "next/server";

import { createAgentForIdentity } from "../../../src/server/agent-provider.ts";
import {
  type AgentSource,
  InlineAgentExecutor,
} from "../../../src/server/agent-runtime/executor.ts";
import { AgentRequestRunner } from "../../../src/server/agent-runtime/request-runner.ts";
import { InMemorySessionStore } from "../../../src/server/agent-runtime/store.ts";
import { GUEST_TENANT_ID, resolveGuestIdentity } from "../../../src/server/identity.ts";

export const runtime = "nodejs";

type AgentFactory = (identity: { tenantId: string; userId: string }) => Promise<StreamableAgent>;

// Test seams: an injected agent or factory short-circuits per-run agent
// creation. The factory is memoized as a singleton with retry-on-failure so the
// existing contract tests keep their initialization semantics. When neither is
// set, production creates a fresh user-scoped agent per turn.
let injectedAgent: StreamableAgent | null = null;
let injectedFactory: AgentFactory | null = null;
let memoizedFactory: Promise<StreamableAgent> | null = null;

export function setAgentForTest(agent: StreamableAgent | null): void {
  injectedAgent = agent;
  memoizedFactory = null;
}

export function setAgentFactoryForTest(factory: AgentFactory | null): void {
  injectedFactory = factory;
  memoizedFactory = null;
}

const dynamicAgentSource: AgentSource = (identity) => {
  if (injectedAgent !== null) return injectedAgent;
  if (injectedFactory) {
    if (memoizedFactory === null) {
      const initialization = injectedFactory(identity);
      memoizedFactory = initialization;
      void initialization.catch(() => {
        if (memoizedFactory === initialization) {
          memoizedFactory = null;
        }
      });
    }
    return memoizedFactory;
  }
  return createAgentForIdentity(identity);
};

const store = new InMemorySessionStore();
const executor = new InlineAgentExecutor({ agentSource: dynamicAgentSource });
const runner = new AgentRequestRunner({ executor, store });

export function getSessionStateForTest(
  sessionId: string,
  guestId: string,
): ReturnType<typeof store.loadSession> {
  return store.loadSession({ tenantId: GUEST_TENANT_ID, userId: guestId }, sessionId);
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
  const handle = runner.run(
    {
      identity,
      includeActivity: parsedRequest.includeSubagentActivity,
      message: parsedRequest.message,
      sessionId: parsedRequest.sessionId,
    },
    abortController.signal,
  );

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const update of handle.updates) {
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
      // Stream disconnect: cancel execution and preserve the last committed
      // session state.
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
