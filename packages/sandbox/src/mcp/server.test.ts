import { describe, expect, it } from "bun:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type {
  SandboxBackend,
  SandboxExecuteOptions,
  SandboxRequest,
  SandboxResult,
} from "../types.ts";
import { createSandboxMcpServer } from "./server.ts";

const result: SandboxResult = {
  executionId: "execution-1",
  status: "succeeded",
  exitCode: 0,
  startedAt: "2026-01-01T00:00:00.000Z",
  finishedAt: "2026-01-01T00:00:01.000Z",
  durationMs: 1_000,
  stdout: "done\n",
  stderr: "",
  stdoutTruncated: false,
  stderrTruncated: false,
  artifacts: [{ name: "output.txt", bytes: new Uint8Array([1]) }],
  retryable: false,
  resourceProfile: "sandbox-small",
  backend: "fake",
};

describe("sandbox MCP server", () => {
  it("passes execution arguments to the backend and hides artifacts and backend", async () => {
    let received: SandboxRequest | undefined;
    let receivedOptions: SandboxExecuteOptions | undefined;
    const backend: SandboxBackend = {
      name: "fake",
      capabilities: { isolation: "none", supportsArtifacts: true, supportsAbort: false },
      async execute(request, options) {
        received = request;
        receivedOptions = options;
        return result;
      },
    };
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0.0.0" });
    const server = createSandboxMcpServer({ backend });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const response = await client.callTool({
      name: "execute_python",
      arguments: {
        code: "print('done')",
        stdin: "input",
        argv: ["one"],
        resourceProfile: "sandbox-medium",
        timeoutSeconds: 12,
      },
    });

    expect(received).toEqual({
      code: "print('done')",
      stdin: "input",
      argv: ["one"],
      resourceProfile: "sandbox-medium",
      timeoutSeconds: 12,
    });
    expect(receivedOptions?.executionId).toEqual(expect.any(String));
    expect(response.content).toEqual([
      {
        type: "text",
        text: JSON.stringify({
          ...result,
          artifacts: undefined,
          backend: undefined,
        }),
      },
    ]);
    await Promise.all([client.close(), server.close()]);
  });
});
