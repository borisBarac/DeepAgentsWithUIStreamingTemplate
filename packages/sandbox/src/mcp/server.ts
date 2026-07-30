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

function executionId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `sandbox-mcp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return String(error);
  } catch {
    return "Unknown sandbox error";
  }
}

function internalErrorResult(args: {
  executionId: string;
  resourceProfile: SandboxResult["resourceProfile"] | undefined;
  startedAt: Date;
  error: unknown;
}): PublicSandboxResult {
  const finishedAt = new Date();
  return {
    executionId: args.executionId,
    status: "internal_error",
    exitCode: null,
    startedAt: args.startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: Math.max(0, finishedAt.getTime() - args.startedAt.getTime()),
    stdout: "",
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false,
    failureClass: "internal_error",
    failureMessage: errorMessage(args.error),
    retryable: false,
    resourceProfile: args.resourceProfile ?? "sandbox-small",
  };
}

function textResult(result: PublicSandboxResult) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
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
      const startedAt = new Date();
      const requestExecutionId = executionId();
      try {
        const result = await backend.execute(
          { code, stdin, argv, resourceProfile, timeoutSeconds },
          { executionId: requestExecutionId },
        );
        return textResult(toPublicResult(result));
      } catch (error) {
        return textResult(
          internalErrorResult({
            executionId: requestExecutionId,
            resourceProfile,
            startedAt,
            error,
          }),
        );
      }
    },
  );

  return server;
}
