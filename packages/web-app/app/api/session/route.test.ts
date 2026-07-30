import { describe, expect, it } from "bun:test";

import type { LoadedSession, SessionStore } from "../../../src/server/agent-runtime/types.ts";
import { GUEST_ID_HEADER, GUEST_TENANT_ID } from "../../../src/server/identity.ts";
import { createSessionRequestHandler } from "./route.ts";

const DEFAULT_GUEST_ID = "00000000-0000-4000-8000-000000000001";

function sessionRequest(args: { sessionId?: string; guestId?: string } = {}): Request {
  const url = new URL("http://localhost/api/session");
  if (args.sessionId !== undefined) {
    url.searchParams.set("sessionId", args.sessionId);
  }
  return new Request(url.toString(), {
    headers: {
      [GUEST_ID_HEADER]: args.guestId ?? DEFAULT_GUEST_ID,
    },
    method: "GET",
  });
}

// Fake SessionStore that returns a controlled LoadedSession from loadSession.
// commitSession/recordRun/lastRun are never reached by the handler but must
// satisfy the interface.
function fakeSessionStore(options: { loaded?: LoadedSession } = {}): SessionStore {
  const loaded = options.loaded ?? { record: null, version: 0 };
  return {
    async loadSession() {
      return loaded;
    },
    async commitSession() {
      return true;
    },
    async recordRun() {},
    async lastRun() {
      return null;
    },
  };
}

const HISTORY = [
  { role: "user", content: "Hello" },
  { role: "assistant", content: "Hi there" },
];

function loadedWithHistory(): LoadedSession {
  return {
    record: { failure: null, history: HISTORY, structuredOutput: null },
    version: 1,
  };
}

describe("createSessionRequestHandler — request parsing", () => {
  it("rejects a missing sessionId with 400", async () => {
    const handler = createSessionRequestHandler(fakeSessionStore());
    const response = await handler(sessionRequest());
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/sessionId/i);
  });

  it("rejects an empty sessionId with 400", async () => {
    const handler = createSessionRequestHandler(fakeSessionStore());
    const response = await handler(sessionRequest({ sessionId: "   " }));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/sessionId/i);
  });
});

describe("createSessionRequestHandler — guest identity", () => {
  it("rejects requests without an x-guest-id header with 400", async () => {
    const handler = createSessionRequestHandler(fakeSessionStore());
    const response = await handler(
      new Request("http://localhost/api/session?sessionId=s1", { method: "GET" }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/x-guest-id/i);
  });

  it("rejects a malformed x-guest-id header with 400", async () => {
    const handler = createSessionRequestHandler(fakeSessionStore());
    const response = await handler(
      new Request("http://localhost/api/session?sessionId=s1", {
        headers: { "x-guest-id": "not-a-uuid" },
        method: "GET",
      }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/UUID v4/i);
  });
});

describe("createSessionRequestHandler — history response", () => {
  it("returns 200 with the persisted history for a valid request", async () => {
    const handler = createSessionRequestHandler(fakeSessionStore({ loaded: loadedWithHistory() }));
    const response = await handler(sessionRequest({ sessionId: "session-42" }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { messages: unknown[] };
    expect(body.messages).toEqual(HISTORY);
  });

  it("returns 200 with an empty array when the session is not found", async () => {
    const handler = createSessionRequestHandler(
      fakeSessionStore({ loaded: { record: null, version: 0 } }),
    );
    const response = await handler(sessionRequest({ sessionId: "unknown" }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { messages: unknown[] };
    expect(body.messages).toEqual([]);
  });

  it("passes the resolved identity and sessionId to the store", async () => {
    let capturedIdentity: { tenantId: string; userId: string } | null = null;
    let capturedSessionId: string | null = null;
    const store: SessionStore = {
      async loadSession(identity, sessionId) {
        capturedIdentity = identity;
        capturedSessionId = sessionId;
        return loadedWithHistory();
      },
      async commitSession() {
        return true;
      },
      async recordRun() {},
      async lastRun() {
        return null;
      },
    };
    const handler = createSessionRequestHandler(store);
    await handler(sessionRequest({ sessionId: "  session-42  " }));
    expect(capturedIdentity!).toEqual({ tenantId: GUEST_TENANT_ID, userId: DEFAULT_GUEST_ID });
    expect(capturedSessionId!).toBe("session-42");
  });
});
