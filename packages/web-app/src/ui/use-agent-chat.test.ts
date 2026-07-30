import { afterEach, describe, expect, it } from "bun:test";

import { stopActiveRun } from "./use-agent-chat.ts";

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
