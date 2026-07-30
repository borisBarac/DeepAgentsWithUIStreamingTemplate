import { NextResponse } from "next/server";

import { isRedisConfigured } from "../../../src/server/redis/client.ts";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  return NextResponse.json({ status: "ok" });
}

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
