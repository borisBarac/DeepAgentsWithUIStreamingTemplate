import { describe, expect, it } from "bun:test";

import {
  createLinkloomMcpClient,
  LINKLOOM_MCP_SERVER_NAME,
  LINKLOOM_MCP_TOOL_NAMES,
} from "./linkloom.ts";

describe("Linkloom MCP", () => {
  it("configures the installed Linkloom package as a stdio MCP server", () => {
    const client = createLinkloomMcpClient();
    const connection = client.config.mcpServers[LINKLOOM_MCP_SERVER_NAME];
    if (!connection) {
      throw new Error("Expected Linkloom MCP server configuration.");
    }

    expect(client.config).toMatchObject({
      throwOnLoadError: true,
      useStandardContentBlocks: true,
      mcpServers: {
        [LINKLOOM_MCP_SERVER_NAME]: {
          transport: "stdio",
          command: "bun",
        },
      },
    });
    expect("args" in connection && connection.args).toHaveLength(1);
    expect("args" in connection && connection.args[0]?.endsWith("/linkloom/src/mcp.ts")).toBe(true);
  });

  it("accepts stdio process overrides", () => {
    const client = createLinkloomMcpClient({
      command: "linkloom-mcp",
      args: [],
      cwd: "/workspace",
      env: { PAGE_LOAD_TIMEOUT: "20000" },
      stderr: "pipe",
      restart: { enabled: true, maxAttempts: 2, delayMs: 100 },
      defaultToolTimeout: 30_000,
    });

    expect(client.config.mcpServers[LINKLOOM_MCP_SERVER_NAME]).toMatchObject({
      command: "linkloom-mcp",
      args: [],
      cwd: "/workspace",
      env: { PAGE_LOAD_TIMEOUT: "20000" },
      stderr: "pipe",
      restart: { enabled: true, maxAttempts: 2, delayMs: 100 },
      defaultToolTimeout: 30_000,
    });
  });

  it("documents the tool surface exposed by Linkloom 0.1.x", () => {
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

describe("Linkloom MCP environment propagation", () => {
  type StdioConnectionWithEnv = { env?: Record<string, string> };

  function readEnv(): Record<string, string> {
    const client = createLinkloomMcpClient();
    const connection = client.config.mcpServers[LINKLOOM_MCP_SERVER_NAME] as StdioConnectionWithEnv;
    return connection.env ?? {};
  }

  function readEnvWithOptions(options: Parameters<typeof createLinkloomMcpClient>[0]) {
    const client = createLinkloomMcpClient(options);
    const connection = client.config.mcpServers[LINKLOOM_MCP_SERVER_NAME] as StdioConnectionWithEnv;
    return connection.env ?? {};
  }

  it("merges caller env on top of process.env so inherited variables survive", () => {
    const env = readEnvWithOptions({
      env: { LINKLOOM_TEST_OVERRIDE: "from-caller", PATH: "caller-path" },
    });

    expect(env.LINKLOOM_TEST_OVERRIDE).toBe("from-caller");
    expect(typeof env.PATH).toBe("string");
    expect(env.PATH).toBe("caller-path");
  });

  it("propagates CAMOUFOX_INSTALL_DIR from the explicit option", () => {
    const env = readEnvWithOptions({ camoufoxInstallDir: "/option/camoufox" });
    expect(env.CAMOUFOX_INSTALL_DIR).toBe("/option/camoufox");
  });

  it("falls back to process.env.CAMOUFOX_INSTALL_DIR when no option is given", () => {
    const previous = process.env.CAMOUFOX_INSTALL_DIR;
    process.env.CAMOUFOX_INSTALL_DIR = "/env/camoufox";
    try {
      expect(readEnv().CAMOUFOX_INSTALL_DIR).toBe("/env/camoufox");
    } finally {
      if (previous === undefined) delete process.env.CAMOUFOX_INSTALL_DIR;
      else process.env.CAMOUFOX_INSTALL_DIR = previous;
    }
  });

  it("lets the explicit option take precedence over process.env", () => {
    const previous = process.env.CAMOUFOX_INSTALL_DIR;
    process.env.CAMOUFOX_INSTALL_DIR = "/env/camoufox";
    try {
      const env = readEnvWithOptions({ camoufoxInstallDir: "/option/camoufox" });
      expect(env.CAMOUFOX_INSTALL_DIR).toBe("/option/camoufox");
    } finally {
      if (previous === undefined) delete process.env.CAMOUFOX_INSTALL_DIR;
      else process.env.CAMOUFOX_INSTALL_DIR = previous;
    }
  });

  it("omits CAMOUFOX_INSTALL_DIR when neither option nor env var is provided", () => {
    const previous = process.env.CAMOUFOX_INSTALL_DIR;
    delete process.env.CAMOUFOX_INSTALL_DIR;
    try {
      expect(readEnv().CAMOUFOX_INSTALL_DIR).toBeUndefined();
    } finally {
      if (previous !== undefined) process.env.CAMOUFOX_INSTALL_DIR = previous;
    }
  });
});
