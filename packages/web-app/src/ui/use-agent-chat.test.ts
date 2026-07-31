import { afterEach, describe, expect, it } from "bun:test";

import { applyAgentStreamLine, consumeAgentStream, stopActiveRun } from "./use-agent-chat.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("stopActiveRun", () => {
  it("requests cancellation then closes the local reader", async () => {
    const requests: { input: RequestInfo | URL; init?: RequestInit }[] = [];
    let closed = false;
    globalThis.fetch = (async (input, init) => {
      requests.push({ init, input });
      return new Response(null, { status: 202 });
    }) as typeof fetch;
    const reader = {
      async cancel() {
        closed = true;
      },
    } as unknown as ReadableStreamDefaultReader<Uint8Array>;

    await stopActiveRun("run-42", reader);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.input).toBe("/api/agent/cancel");
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({ runId: "run-42" });
    expect(closed).toBe(true);
  });
});

describe("agent stream recovery protocol", () => {
  const handlers = (messages: string[]) => ({
    onError: () => {},
    onMessage: (text: string) => messages.push(text),
    onSpec: () => {},
  });

  it("applies framed updates and returns the Redis cursor", () => {
    const messages: string[] = [];
    expect(
      applyAgentStreamLine(
        JSON.stringify({ eventId: "42-0", update: { text: "hello", type: "message" } }),
        handlers(messages),
      ),
    ).toBe("42-0");
    expect(messages).toEqual(["hello"]);
  });

  it("preserves the latest cursor while consuming a reattached stream", async () => {
    const messages: string[] = [];
    const cursors: string[] = [];
    const response = new Response(
      `${JSON.stringify({ eventId: "43-0", update: { text: "missed", type: "message" } })}\n`,
    );

    await consumeAgentStream(
      response,
      handlers(messages),
      (eventId) => cursors.push(eventId),
      () => {},
    );

    expect(messages).toEqual(["missed"]);
    expect(cursors).toEqual(["43-0"]);
  });
});
