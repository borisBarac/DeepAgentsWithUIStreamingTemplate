import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { createDockerSandboxBackend } from "../backends/index.ts";
import type { SandboxBackend, SandboxResult } from "../types.ts";

export type SandboxMcpServerOptions = {
  backend?: SandboxBackend;
};

type PublicSandboxResult = Omit<SandboxResult, "artifacts" | "backend">;

function toPublicResult(result: SandboxResult): PublicSandboxResult {
  const { artifacts: _artifacts, backend: _backend, ...publicResult } = result;
  return publicResult;
}

export function createSandboxMcpServer(options: SandboxMcpServerOptions = {}): McpServer {
  const backend = options.backend ?? createDockerSandboxBackend();
  const server = new McpServer({ name: "sandbox", version: "0.1.0" });

  server.registerTool(
    "execute_python",
    {
      description: "Execute Python code in an isolated Docker sandbox.",
      inputSchema: {
        code: z.string().min(1),
        stdin: z.string().optional(),
        argv: z.array(z.string()).optional(),
        resourceProfile: z.enum(["sandbox-small", "sandbox-medium", "sandbox-large"]).optional(),
        timeoutSeconds: z.number().positive().optional(),
      },
    },
    async ({ code, stdin, argv, resourceProfile, timeoutSeconds }) => {
      const result = await backend.execute(
        { code, stdin, argv, resourceProfile, timeoutSeconds },
        { executionId: crypto.randomUUID() },
      );
      return { content: [{ type: "text", text: JSON.stringify(toPublicResult(result)) }] };
    },
  );

  return server;
}
