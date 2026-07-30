import { describe, expect, it, type Mock, mock } from "bun:test";

import type { MultiServerMCPClient } from "@langchain/mcp-adapters";

import { createSandboxConnection, type SandboxMcpConnection } from "./sandbox.ts";

type CloseSpy = Mock<() => Promise<void>>;

function fakeMcpClient(close: CloseSpy): MultiServerMCPClient {
  return { close } as unknown as MultiServerMCPClient;
}

describe("SandboxMcpConnection lifecycle", () => {
  it("closes the underlying MCP client exactly once", async () => {
    const close = mock(async () => {});
    const connection = createSandboxConnection(fakeMcpClient(close), []);
    await connection.close();
    await connection.close();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("supports async disposal", async () => {
    const close = mock(async () => {});
    const connection = createSandboxConnection(fakeMcpClient(close), []);
    await connection[Symbol.asyncDispose]();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("propagates close failures and remains closed", async () => {
    const close = mock(async () => {
      throw new Error("boom");
    });
    const connection = createSandboxConnection(fakeMcpClient(close), []);

    await expect(connection.close()).rejects.toThrow("boom");
    await connection.close();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it.skipIf(typeof Bun === "undefined" || typeof Bun.gc !== "function")(
    "closes the MCP client when the connection is garbage collected",
    async () => {
      const close = mock(async () => {});
      let connection: SandboxMcpConnection | null = createSandboxConnection(
        fakeMcpClient(close),
        [],
      );
      const weak = new WeakRef(connection);
      connection = null;

      const finalized = await new Promise<boolean>((resolve) => {
        let attempts = 0;
        const tick = () => {
          attempts += 1;
          Bun.gc(true);
          if (close.mock.calls.length > 0) return resolve(true);
          if (attempts >= 50) return resolve(false);
          setTimeout(tick, 5);
        };
        tick();
      });

      expect(finalized).toBe(true);
      expect(close).toHaveBeenCalledTimes(1);
      expect(weak.deref()).toBeUndefined();
    },
  );
});
