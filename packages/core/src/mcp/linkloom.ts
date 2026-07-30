/// <reference lib="esnext.disposable" />
import {
  type ClientConfig,
  MultiServerMCPClient,
  type StreamableHTTPConnection,
} from "@langchain/mcp-adapters";

export const LINKLOOM_MCP_SERVER_NAME = "linkloom";
export const LINKLOOM_MCP_TOOL_NAMES = [
  "scrape",
  "html_to_markdown",
  "pdf_to_markdown",
  "render_page",
  "extract_links",
  "extract_tables",
  "search_web",
] as const;

export const DEFAULT_LINKLOOM_MCP_URL = "http://localhost:3001/mcp";
export const DEFAULT_LINKLOOM_MCP_DISCOVERY_TIMEOUT = 10_000;

export type LinkloomMcpOptions = {
  url?: string;
  defaultToolTimeout?: number;
  discoveryTimeout?: number;
};

export type LinkloomResearchConnection = {
  client: Pick<MultiServerMCPClient, "close">;
  tools: Awaited<ReturnType<MultiServerMCPClient["getTools"]>>;
  close: () => Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
};

const linkloomFinalizer = new FinalizationRegistry((held: { close: () => Promise<void> }) => {
  void held.close().catch(() => {
    // Best-effort: a GC callback cannot surface errors, and the remote HTTP
    // server reaps idle sessions on its own schedule regardless.
  });
});

export function createLinkloomMcpClient(
  options: Partial<LinkloomMcpOptions> = {},
): MultiServerMCPClient {
  const url = options.url ?? process.env.LINKLOOM_MCP_URL ?? DEFAULT_LINKLOOM_MCP_URL;
  const connection: StreamableHTTPConnection = {
    transport: "http",
    url,
    ...(options.defaultToolTimeout !== undefined
      ? { defaultToolTimeout: options.defaultToolTimeout }
      : {}),
  };
  const config: ClientConfig = {
    throwOnLoadError: true,
    useStandardContentBlocks: true,
    mcpServers: {
      [LINKLOOM_MCP_SERVER_NAME]: connection,
    },
  };

  return new MultiServerMCPClient(config);
}

export function createLinkloomConnection(
  client: Pick<MultiServerMCPClient, "close">,
  tools: Awaited<ReturnType<MultiServerMCPClient["getTools"]>>,
): LinkloomResearchConnection {
  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await client.close();
  };

  const connection: LinkloomResearchConnection = {
    client,
    tools,
    close,
    [Symbol.asyncDispose]: close,
  };
  linkloomFinalizer.register(connection, { close });
  return connection;
}

export async function connectLinkloomResearchTools(
  options: Partial<LinkloomMcpOptions> = {},
): Promise<LinkloomResearchConnection> {
  const discoveryTimeout = options.discoveryTimeout ?? DEFAULT_LINKLOOM_MCP_DISCOVERY_TIMEOUT;
  const client = createLinkloomMcpClient(options);

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const discoveryTimeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new Error(`Linkloom MCP tool discovery timed out after ${discoveryTimeout}ms`)),
      discoveryTimeout,
    );
  });

  const discoveryPromise = client.getTools();
  try {
    const tools = await Promise.race([discoveryPromise, discoveryTimeoutPromise]);
    return createLinkloomConnection(client, tools);
  } catch (error) {
    await client.close().catch(() => {
      // Swallow teardown failures so the original discovery error is surfaced.
    });
    throw error;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    // The abandoned discovery promise can settle later (e.g. once the remote
    // closes the socket). Attach a no-op rejection handler so it never surfaces
    // as an unhandled rejection after the timeout/connection error wins.
    void discoveryPromise.catch(() => {});
  }
}
