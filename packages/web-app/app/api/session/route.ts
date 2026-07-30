import { NextResponse } from "next/server";

import type { SessionStore } from "../../../src/server/agent-runtime/types.ts";
import { resolveGuestIdentity } from "../../../src/server/identity.ts";
import { RedisSessionStore } from "../../../src/server/redis/redis-session-store.ts";

export const runtime = "nodejs";

// Factory: build a request handler backed by an injected SessionStore.
// Production passes the lazily-cached Redis store; route tests pass a fake
// that returns a controlled LoadedSession. The handler owns request
// validation, identity resolution, and mapping the persisted history to a
// JSON response.
export function createSessionRequestHandler(
  sessionStore: SessionStore,
): (request: Request) => Promise<Response> {
  return async function handleSessionRequest(request: Request): Promise<Response> {
    let identity: { tenantId: string; userId: string };
    try {
      identity = resolveGuestIdentity(request);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 400 },
      );
    }

    const sessionId = new URL(request.url).searchParams.get("sessionId")?.trim();
    if (!sessionId) {
      return NextResponse.json({ error: "sessionId is required." }, { status: 400 });
    }

    const loaded = await sessionStore.loadSession(identity, sessionId);
    return Response.json({ messages: loaded.record?.history ?? [] });
  };
}

// Production always uses Redis. The store is built once and cached for the
// lifetime of the process, mirroring getProductionExecutor in the agent route.
let cachedSessionStore: SessionStore | null = null;

async function getProductionSessionStore(): Promise<SessionStore> {
  if (cachedSessionStore) return cachedSessionStore;
  const prefix = (process.env.REDIS_KEY_PREFIX ?? "dat:").trim();
  const { getSharedRedis } = await import("../../../src/server/redis/client.ts");
  const client = await getSharedRedis();
  cachedSessionStore = new RedisSessionStore({ client, keyPrefix: prefix });
  return cachedSessionStore;
}

export async function GET(request: Request): Promise<Response> {
  return createSessionRequestHandler(await getProductionSessionStore())(request);
}
