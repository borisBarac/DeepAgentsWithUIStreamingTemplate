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

  it("returns an internal-error result when backend execution throws", async () => {
    const response = await callTool({
      name: "fake",
      capabilities: { isolation: "none", supportsArtifacts: false, supportsAbort: false },
      async execute() {
        throw new Error("backend unavailable");
      },
    });

    expect(publicResult(response)).toMatchObject({
      executionId: expect.any(String),
      status: "internal_error",
      exitCode: null,
      startedAt: expect.any(String),
      finishedAt: expect.any(String),
      stdout: "",
      stderr: "",
      failureClass: "internal_error",
      failureMessage: "backend unavailable",
      retryable: false,
      resourceProfile: "sandbox-small",
    });
  });

  it("returns an internal-error result for preflight and cleanup failures", async () => {
    for (const failureMessage of ["preflight failed", "cleanup failed"]) {
      const response = await callTool({
        name: "fake",
        capabilities: { isolation: "none", supportsArtifacts: false, supportsAbort: false },
        async execute() {
          throw failureMessage;
        },
      });

      expect(publicResult(response)).toMatchObject({
        status: "internal_error",
        failureClass: "internal_error",
        failureMessage,
        stdout: "",
        stderr: "",
      });
    }
  });

  it("returns an internal-error result when result projection or serialization throws", async () => {
    const projectionResponse = await callTool({
      name: "fake",
      capabilities: { isolation: "none", supportsArtifacts: false, supportsAbort: false },
      async execute() {
        return {
          get artifacts(): never {
            throw new Error("post-run collection failed");
          },
        } as unknown as SandboxResult;
      },
    });
    const serializationResponse = await callTool({
      name: "fake",
      capabilities: { isolation: "none", supportsArtifacts: false, supportsAbort: false },
      async execute() {
        return {
          ...result,
          stdout: {
            toJSON: () => {
              throw new Error("result serialization failed");
            },
          },
        } as unknown as SandboxResult;
      },
    });

    expect(publicResult(projectionResponse)).toMatchObject({
      status: "internal_error",
      failureClass: "internal_error",
      failureMessage: "post-run collection failed",
      stdout: "",
      stderr: "",
    });
    expect(publicResult(serializationResponse)).toMatchObject({
      status: "internal_error",
      failureClass: "internal_error",
      failureMessage: "result serialization failed",
      stdout: "",
      stderr: "",
    });
  });
});

async function callTool(backend: SandboxBackend) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  const server = createSandboxMcpServer({ backend });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  try {
    return await client.callTool({ name: "execute_python", arguments: { code: "print('done')" } });
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
}

function publicResult(response: unknown) {
  const content = (response as { content?: unknown }).content;
  if (!Array.isArray(content) || content[0]?.type !== "text") {
    throw new Error("Expected a text tool response.");
  }
  return JSON.parse(content[0].text) as Record<string, unknown>;
}
