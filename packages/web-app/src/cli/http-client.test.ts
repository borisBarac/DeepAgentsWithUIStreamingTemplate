import { afterEach, describe, expect, it } from "bun:test";

import type { UiUpdate } from "@deep-agent-template/core/generative-ui/types";

import { streamAgentUpdates } from "./http-client.ts";

type ServerHandle = { close: () => Promise<void>; url: string };

function startServer(responder: (request: Request) => Response | Promise<Response>): ServerHandle {
  const server = Bun.serve({
    fetch: (request) => responder(request),
    port: 0,
  });
  return {
    close: () => Promise.resolve(server.stop(true)),
    url: `http://localhost:${server.port}`,
  };
}

function ndjsonResponse(
  lines: UiUpdate[],
  options: { status?: number; chunked?: boolean } = {},
): Response {
  const { status = 200, chunked = false } = options;
  const body = chunked
    ? new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder();
          for (const [index, line] of lines.entries()) {
            controller.enqueue(
              encoder.encode(`${JSON.stringify({ eventId: `${index + 1}-0`, update: line })}\n`),
            );
          }
          controller.close();
        },
      })
    : `${lines
        .map((line, index) => JSON.stringify({ eventId: `${index + 1}-0`, update: line }))
        .join("\n")}\n`;
  return new Response(body, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
    status,
  });
}

async function runOnce(
  baseUrl: string,
  options: { message: string; sessionId: string; includeActivity: boolean },
): Promise<{ updates: UiUpdate[]; errors: { status: number; message: string }[] }> {
  const updates: UiUpdate[] = [];
  const errors: { status: number; message: string }[] = [];
  await streamAgentUpdates(
    {
      baseUrl,
      includeActivity: options.includeActivity,
      message: options.message,
      sessionId: options.sessionId,
    },
    {
      onUpdate: (update) => updates.push(update),
      onError: (error) => errors.push({ message: error.message, status: error.status }),
    },
  );
  return { errors, updates };
}

describe("streamAgentUpdates", () => {
  afterEach(() => {
    // Servers in this suite stop themselves inline; nothing global to clear.
  });

  it("posts JSON and yields every parsed NDJSON line", async () => {
    let receivedBody: unknown = null;
    const server = startServer(async (request) => {
      receivedBody = await request.json();
      return ndjsonResponse([
        { type: "message", text: "hello" },
        { type: "message", text: "world" },
      ]);
    });
    try {
      const { errors, updates } = await runOnce(server.url, {
        includeActivity: true,
        message: "hi",
        sessionId: "sess-1",
      });
      expect(errors).toEqual([]);
      expect(updates).toEqual([
        { type: "message", text: "hello" },
        { type: "message", text: "world" },
      ]);
      expect(receivedBody).toEqual({
        includeSubagentActivity: true,
        message: "hi",
        sessionId: "sess-1",
      });
    } finally {
      await server.close();
    }
  });

  it("buffers partial NDJSON lines across chunks", async () => {
    const server = startServer(() =>
      ndjsonResponse(
        [
          { type: "message", text: "chunked" },
          { type: "ui", components: [{ id: "a", component: "Text", text: "hi" }] },
        ],
        { chunked: true },
      ),
    );
    try {
      const { errors, updates } = await runOnce(server.url, {
        includeActivity: false,
        message: "hi",
        sessionId: "sess-2",
      });
      expect(errors).toEqual([]);
      expect(updates.map((u) => u.type)).toEqual(["message", "ui"]);
    } finally {
      await server.close();
    }
  });

  it("surfaces invalid lines as synthetic error updates (website parity)", async () => {
    const server = startServer(() => {
      const body = [
        '{"type":"message","text":"ok"}',
        "",
        "   ",
        "not-json",
        '{"type":"ui","components":[{"id":"a","component":"Bogus","text":"x"}]}',
        '{"type":"error","message":"bad"}',
      ].join("\n");
      return new Response(`${body}\n`, {
        headers: { "Content-Type": "application/x-ndjson" },
      });
    });
    try {
      const { errors, updates } = await runOnce(server.url, {
        includeActivity: true,
        message: "hi",
        sessionId: "sess-3",
      });
      expect(errors).toEqual([]);
      expect(updates).toEqual([
        { type: "message", text: "ok" },
        { type: "error", message: "This line is not valid JSON." },
        {
          type: "error",
          message: 'Component "Bogus" is not in the catalog.',
        },
        { type: "error", message: "bad" },
      ]);
    } finally {
      await server.close();
    }
  });

  it("reports a non-2xx response with status and body", async () => {
    const server = startServer(() => new Response("server is sad", { status: 500 }));
    try {
      const { errors, updates } = await runOnce(server.url, {
        includeActivity: true,
        message: "hi",
        sessionId: "sess-4",
      });
      expect(updates).toEqual([]);
      expect(errors).toEqual([{ message: "server is sad", status: 500 }]);
    } finally {
      await server.close();
    }
  });

  it("joins the base url path safely", async () => {
    let capturedUrl = "";
    const server = startServer((request) => {
      capturedUrl = request.url;
      return ndjsonResponse([{ type: "message", text: "ok" }]);
    });
    try {
      await runOnce(`${server.url}/`, {
        includeActivity: true,
        message: "hi",
        sessionId: "sess-5",
      });
      expect(capturedUrl.endsWith("/api/agent")).toBe(true);
    } finally {
      await server.close();
    }
  });
});
