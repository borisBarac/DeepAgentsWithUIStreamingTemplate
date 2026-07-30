import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

export type SandboxMcpHttpServerOptions = {
  host?: string;
  port?: number;
};

export async function startSandboxHttpServer(
  server: McpServer,
  options: SandboxMcpHttpServerOptions = {},
): Promise<Bun.Server<undefined>> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
  });
  await server.connect(transport);

  return Bun.serve<undefined>({
    hostname: options.host ?? "0.0.0.0",
    port: options.port ?? 3010,
    fetch(request) {
      if (request.method === "GET" && new URL(request.url).pathname === "/health") {
        return new Response("OK");
      }
      return transport.handleRequest(request);
    },
  });
}

export async function startSandboxStdioServer(server: McpServer): Promise<void> {
  await server.connect(new StdioServerTransport());
}
