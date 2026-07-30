/// <reference lib="esnext.disposable" />
import {
  type ClientConfig,
  MultiServerMCPClient,
  type StreamableHTTPConnection,
} from "@langchain/mcp-adapters";

export const SANDBOX_MCP_SERVER_NAME = "sandbox";
export const SANDBOX_MCP_TOOL_NAMES = ["execute_python"] as const;
export const DEFAULT_SANDBOX_MCP_URL = "http://localhost:3010/mcp";
export const DEFAULT_SANDBOX_MCP_DISCOVERY_TIMEOUT = 10_000;

export type SandboxMcpOptions = {
  url?: string;
  defaultToolTimeout?: number;
  discoveryTimeout?: number;
};

export type SandboxMcpConnection = {
  client: Pick<MultiServerMCPClient, "close">;
  tools: Awaited<ReturnType<MultiServerMCPClient["getTools"]>>;
  close: () => Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
};

const sandboxFinalizer = new FinalizationRegistry((held: { close: () => Promise<void> }) => {
  void held.close().catch(() => {});
});

export function createSandboxMcpClient(
  options: Partial<SandboxMcpOptions> = {},
): MultiServerMCPClient {
  const connection: StreamableHTTPConnection = {
    transport: "http",
    url: options.url ?? process.env.SANDBOX_MCP_URL ?? DEFAULT_SANDBOX_MCP_URL,
    ...(options.defaultToolTimeout === undefined
      ? {}
      : { defaultToolTimeout: options.defaultToolTimeout }),
  };
  const config: ClientConfig = {
    throwOnLoadError: true,
    useStandardContentBlocks: true,
    mcpServers: { [SANDBOX_MCP_SERVER_NAME]: connection },
  };
  return new MultiServerMCPClient(config);
}

export function createSandboxConnection(
  client: Pick<MultiServerMCPClient, "close">,
  tools: Awaited<ReturnType<MultiServerMCPClient["getTools"]>>,
): SandboxMcpConnection {
  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await client.close();
  };
  const connection: SandboxMcpConnection = {
    client,
    tools,
    close,
    [Symbol.asyncDispose]: close,
  };
  sandboxFinalizer.register(connection, { close });
  return connection;
}

export async function connectSandboxTools(
  options: Partial<SandboxMcpOptions> = {},
): Promise<SandboxMcpConnection> {
  const client = createSandboxMcpClient(options);
  const timeout = options.discoveryTimeout ?? DEFAULT_SANDBOX_MCP_DISCOVERY_TIMEOUT;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const discovery = client.getTools();
  try {
    const tools = await Promise.race([
      discovery,
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(`Sandbox MCP tool discovery timed out after ${timeout}ms`)),
          timeout,
        );
      }),
    ]);
    return createSandboxConnection(client, tools);
  } catch (error) {
    await client.close().catch(() => {});
    throw error;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    void discovery.catch(() => {});
  }
}
