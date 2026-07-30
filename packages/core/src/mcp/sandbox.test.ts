import { describe, expect, it, spyOn } from "bun:test";

import { MultiServerMCPClient } from "@langchain/mcp-adapters";

import {
  connectSandboxTools,
  createSandboxMcpClient,
  DEFAULT_SANDBOX_MCP_DISCOVERY_TIMEOUT,
  DEFAULT_SANDBOX_MCP_URL,
  SANDBOX_MCP_SERVER_NAME,
  SANDBOX_MCP_TOOL_NAMES,
} from "./sandbox.ts";

describe("Sandbox MCP", () => {
  it("configures the streamable HTTP server at the default URL", () => {
    const previous = process.env.SANDBOX_MCP_URL;
    delete process.env.SANDBOX_MCP_URL;
    try {
      const client = createSandboxMcpClient();
      expect(client.config).toMatchObject({
        throwOnLoadError: true,
        useStandardContentBlocks: true,
        mcpServers: {
          [SANDBOX_MCP_SERVER_NAME]: { transport: "http", url: DEFAULT_SANDBOX_MCP_URL },
        },
      });
    } finally {
      if (previous !== undefined) process.env.SANDBOX_MCP_URL = previous;
    }
  });

  it("accepts explicit URL and tool timeout overrides", () => {
    const client = createSandboxMcpClient({
      url: "http://sandbox.local:9090/mcp",
      defaultToolTimeout: 30_000,
    });
    expect(client.config.mcpServers[SANDBOX_MCP_SERVER_NAME]).toMatchObject({
      transport: "http",
      url: "http://sandbox.local:9090/mcp",
      defaultToolTimeout: 30_000,
    });
  });

  it("uses the environment URL when no explicit URL is given", () => {
    const previous = process.env.SANDBOX_MCP_URL;
    process.env.SANDBOX_MCP_URL = "http://env-host:7000/mcp";
    try {
      expect(createSandboxMcpClient().config.mcpServers[SANDBOX_MCP_SERVER_NAME]).toMatchObject({
        url: "http://env-host:7000/mcp",
      });
    } finally {
      if (previous === undefined) delete process.env.SANDBOX_MCP_URL;
      else process.env.SANDBOX_MCP_URL = previous;
    }
  });

  it("documents the sole execution tool and bounded discovery timeout", () => {
    expect(SANDBOX_MCP_TOOL_NAMES).toEqual(["execute_python"]);
    expect(DEFAULT_SANDBOX_MCP_DISCOVERY_TIMEOUT).toBe(10_000);
  });
});

describe("connectSandboxTools failure handling", () => {
  it("cleans up after an unreachable server", async () => {
    const closeSpy = spyOn(MultiServerMCPClient.prototype, "close");
    try {
      await expect(connectSandboxTools({ url: "http://127.0.0.1:9/mcp" })).rejects.toThrow(
        "Unable to connect",
      );
      expect(closeSpy).toHaveBeenCalledTimes(1);
    } finally {
      closeSpy.mockRestore();
    }
  });

  it("times out discovery against a reachable endpoint that stalls", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => new Promise<Response>(() => {}),
    });
    try {
      await expect(
        connectSandboxTools({
          url: `http://127.0.0.1:${server.port}/mcp`,
          discoveryTimeout: 25,
        }),
      ).rejects.toThrow("Sandbox MCP tool discovery timed out after 25ms");
    } finally {
      server.stop(true);
    }
  });
});
