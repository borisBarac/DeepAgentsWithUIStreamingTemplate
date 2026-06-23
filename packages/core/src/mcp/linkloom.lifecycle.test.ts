import { describe, expect, it, type Mock, mock } from "bun:test";

import type { MultiServerMCPClient } from "@langchain/mcp-adapters";

import { createLinkloomConnection, type LinkloomResearchConnection } from "./linkloom.ts";

type CloseSpy = Mock<() => Promise<void>>;

function fakeMcpClient(closeSpy: CloseSpy): MultiServerMCPClient {
  return { close: closeSpy } as unknown as MultiServerMCPClient;
}

describe("LinkloomResearchConnection lifecycle", () => {
  it("closes the underlying MCP client exactly once on repeated close() calls", async () => {
    const closeSpy = mock(async () => {});
    const connection = createLinkloomConnection(fakeMcpClient(closeSpy), []);

    await connection.close();
    await connection.close();
    await connection.close();

    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it("does not close until close() is invoked", async () => {
    const closeSpy = mock(async () => {});
    const connection = createLinkloomConnection(fakeMcpClient(closeSpy), []);

    await Promise.resolve();
    await Promise.resolve();
    expect(closeSpy).not.toHaveBeenCalled();

    await connection.close();
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it("exposes [Symbol.asyncDispose] that delegates to close()", async () => {
    const closeSpy = mock(async () => {});
    const connection = createLinkloomConnection(fakeMcpClient(closeSpy), []);

    expect(typeof connection[Symbol.asyncDispose]).toBe("function");

    await connection[Symbol.asyncDispose]();
    await connection[Symbol.asyncDispose]();

    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it("propagates close failures to the caller and stays closed", async () => {
    const closeSpy = mock(async () => {
      throw new Error("boom");
    });
    const connection = createLinkloomConnection(fakeMcpClient(closeSpy), []);

    await expect(connection.close()).rejects.toThrow("boom");
    await connection.close();
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  // Best-effort per JS spec: finalizer delivery is not contractual, but JSC
  // delivers it within a few event-loop turns once the target is unreachable.
  // Skipped when a forced GC API is unavailable.
  it.skipIf(typeof Bun === "undefined" || typeof Bun.gc !== "function")(
    "closes the MCP client when the connection is garbage collected",
    async () => {
      const closeSpy = mock(async () => {});
      let connection: LinkloomResearchConnection | null = createLinkloomConnection(
        fakeMcpClient(closeSpy),
        [],
      );
      const weak = new WeakRef(connection);
      connection = null;

      const finalized = await new Promise<boolean>((resolve) => {
        let attempts = 0;
        const tick = () => {
          attempts += 1;
          Bun.gc(true);
          if (closeSpy.mock.calls.length > 0) {
            resolve(true);
            return;
          }
          if (attempts >= 50) {
            resolve(false);
            return;
          }
          setTimeout(tick, 5);
        };
        tick();
      });

      expect(finalized).toBe(true);
      expect(closeSpy).toHaveBeenCalledTimes(1);
      expect(weak.deref()).toBeUndefined();
    },
  );
});
