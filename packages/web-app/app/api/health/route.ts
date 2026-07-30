import { NextResponse } from "next/server";

import { isRedisConfigured } from "../../../src/server/redis/client.ts";

export const runtime = "nodejs";

// Liveness probe — always 200 if the process is responsive. Use this for
// orchestrator restart decisions (k8s livenessProbe, Docker healthcheck).
export async function GET(): Promise<Response> {
  return NextResponse.json({ status: "ok" });
}

// Readiness probe — 200 only when required Redis is configured and reachable.
export async function HEAD(): Promise<Response> {
  if (!isRedisConfigured()) {
    return new Response(null, { status: 503 });
  }
  try {
    const { getSharedRedis } = await import("../../../src/server/redis/client.ts");
    const client = await getSharedRedis();
    const pong = await client.ping();
    if (pong !== "PONG") {
      return new Response(null, { status: 503 });
    }
    return new Response(null, { status: 200 });
  } catch {
    return new Response(null, { status: 503 });
  }
}
