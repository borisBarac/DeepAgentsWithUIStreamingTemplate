import { describe, expect, it, spyOn } from "bun:test";

import { MultiServerMCPClient } from "@langchain/mcp-adapters";

import {
  connectLinkloomResearchTools,
  createLinkloomMcpClient,
  DEFAULT_LINKLOOM_MCP_DISCOVERY_TIMEOUT,
  DEFAULT_LINKLOOM_MCP_URL,
  LINKLOOM_MCP_SERVER_NAME,
  LINKLOOM_MCP_TOOL_NAMES,
} from "./linkloom.ts";

describe("Linkloom MCP", () => {
  it("configures Linkloom as a streamable HTTP MCP server at the default URL", () => {
    const previous = process.env.LINKLOOM_MCP_URL;
    delete process.env.LINKLOOM_MCP_URL;
    try {
      const client = createLinkloomMcpClient();

      expect(client.config).toMatchObject({
        throwOnLoadError: true,
        useStandardContentBlocks: true,
        mcpServers: {
          [LINKLOOM_MCP_SERVER_NAME]: {
            transport: "http",
            url: DEFAULT_LINKLOOM_MCP_URL,
          },
        },
      });
    } finally {
      if (previous !== undefined) process.env.LINKLOOM_MCP_URL = previous;
    }
  });

  it("accepts an explicit URL and tool timeout override", () => {
    const client = createLinkloomMcpClient({
      url: "http://linkloom.local:9090/mcp",
      defaultToolTimeout: 30_000,
    });

    expect(client.config.mcpServers[LINKLOOM_MCP_SERVER_NAME]).toMatchObject({
      transport: "http",
      url: "http://linkloom.local:9090/mcp",
      defaultToolTimeout: 30_000,
    });
  });

  it("falls back to the LINKLOOM_MCP_URL env var when no URL option is given", () => {
    const previous = process.env.LINKLOOM_MCP_URL;
    process.env.LINKLOOM_MCP_URL = "http://env-host:7000/mcp";
    try {
      const client = createLinkloomMcpClient();
      expect(client.config.mcpServers[LINKLOOM_MCP_SERVER_NAME]).toMatchObject({
        transport: "http",
        url: "http://env-host:7000/mcp",
      });
    } finally {
      if (previous === undefined) delete process.env.LINKLOOM_MCP_URL;
      else process.env.LINKLOOM_MCP_URL = previous;
    }
  });

  it("lets the explicit URL option take precedence over the env var", () => {
    const previous = process.env.LINKLOOM_MCP_URL;
    process.env.LINKLOOM_MCP_URL = "http://env-host:7000/mcp";
    try {
      const client = createLinkloomMcpClient({ url: "http://option-host:8000/mcp" });
      expect(client.config.mcpServers[LINKLOOM_MCP_SERVER_NAME]).toMatchObject({
        url: "http://option-host:8000/mcp",
      });
    } finally {
      if (previous === undefined) delete process.env.LINKLOOM_MCP_URL;
      else process.env.LINKLOOM_MCP_URL = previous;
    }
  });

  it("omits defaultToolTimeout when none is provided", () => {
    const previous = process.env.LINKLOOM_MCP_URL;
    delete process.env.LINKLOOM_MCP_URL;
    try {
      const client = createLinkloomMcpClient();
      const connection = client.config.mcpServers[LINKLOOM_MCP_SERVER_NAME];
      if (!connection) throw new Error("Expected Linkloom MCP server configuration.");
      expect("defaultToolTimeout" in connection).toBe(false);
    } finally {
      if (previous !== undefined) process.env.LINKLOOM_MCP_URL = previous;
    }
  });

  it("uses a bounded default tool discovery timeout", () => {
    expect(DEFAULT_LINKLOOM_MCP_DISCOVERY_TIMEOUT).toBe(10_000);
  });

  it("documents the tool surface exposed by Linkloom", () => {
    expect(LINKLOOM_MCP_TOOL_NAMES).toEqual([
      "scrape",
      "html_to_markdown",
      "pdf_to_markdown",
      "render_page",
      "extract_links",
      "extract_tables",
      "search_web",
    ]);
  });
});

// Port 9 (discard) is closed on every CI/dev host, so the streamable-HTTP
// handshake fails fast with ECONNREFUSED rather than timing out. This keeps
// the test deterministic and network-free.
const REFUSED_LINKLOOM_URL = "http://127.0.0.1:9/mcp";

describe("connectLinkloomResearchTools failure handling", () => {
  it("rejects when the MCP server is unreachable", async () => {
    await expect(connectLinkloomResearchTools({ url: REFUSED_LINKLOOM_URL })).rejects.toThrow(
      "Unable to connect",
    );
  });

  it("cleans up the MCP client on connection failure", async () => {
    const closeSpy = spyOn(MultiServerMCPClient.prototype, "close");
    try {
      await expect(connectLinkloomResearchTools({ url: REFUSED_LINKLOOM_URL })).rejects.toThrow(
        "Unable to connect",
      );

      expect(closeSpy).toHaveBeenCalledTimes(1);
    } finally {
      closeSpy.mockRestore();
    }
  });

  it("times out discovery against a reachable endpoint that stalls", async () => {
    const closeSpy = spyOn(MultiServerMCPClient.prototype, "close");
    let resolveRequestStarted: () => void;
    const requestStarted = new Promise<void>((resolve) => {
      resolveRequestStarted = resolve;
    });
    const server = Bun.serve({
      port: 0,
      fetch: () => {
        resolveRequestStarted();
        return new Promise<Response>(() => {});
      },
    });

    try {
      const connection = connectLinkloomResearchTools({
        url: `http://localhost:${server.port}/mcp`,
        discoveryTimeout: 25,
      });
      await requestStarted;
      await expect(
        Promise.race([
          connection,
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error("discovery did not time out")), 1_000);
          }),
        ]),
      ).rejects.toThrow("Linkloom MCP tool discovery timed out after 25ms");
      expect(closeSpy).toHaveBeenCalledTimes(1);
    } finally {
      closeSpy.mockRestore();
      server.stop(true);
    }
  });
});
