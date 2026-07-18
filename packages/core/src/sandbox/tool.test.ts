import { describe, expect, it } from "bun:test";

import type { SandboxBackend, SandboxRequest, SandboxResult } from "@deep-agent-template/sandbox";
import { createPythonSandboxTool, pythonSandboxInputSchema } from "./tool.ts";

function makeFakeBackend(capture: {
  request?: SandboxRequest;
  executionId?: string;
}): SandboxBackend {
  return {
    name: "fake",
    capabilities: { isolation: "none", supportsArtifacts: false, supportsAbort: false },
    async execute(request: SandboxRequest, options): Promise<SandboxResult> {
      capture.request = request;
      capture.executionId = options.executionId;
      return {
        executionId: options.executionId,
        status: "succeeded",
        exitCode: 0,
        startedAt: "2025-01-01T00:00:00.000Z",
        finishedAt: "2025-01-01T00:00:00.500Z",
        durationMs: 500,
        stdout: `ran:${request.code.length}`,
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
        artifacts: [],
        retryable: false,
        resourceProfile: request.resourceProfile ?? "sandbox-small",
        backend: "fake",
      };
    },
  };
}

describe("pythonSandboxInputSchema", () => {
  it("rejects empty code", () => {
    const result = pythonSandboxInputSchema.safeParse({ code: "" });
    expect(result.success).toBe(false);
  });

  it("accepts a minimal request", () => {
    const result = pythonSandboxInputSchema.safeParse({ code: "print('hi')" });
    expect(result.success).toBe(true);
  });

  it("accepts the optional fields", () => {
    const result = pythonSandboxInputSchema.safeParse({
      code: "x",
      stdin: "in",
      argv: ["a", "b"],
      resourceProfile: "sandbox-medium",
      timeoutSeconds: 30,
    });
    expect(result.success).toBe(true);
  });

  it("rejects timeoutSeconds above 300", () => {
    const result = pythonSandboxInputSchema.safeParse({ code: "x", timeoutSeconds: 301 });
    expect(result.success).toBe(false);
  });

  it("rejects unknown resource profiles", () => {
    const result = pythonSandboxInputSchema.safeParse({ code: "x", resourceProfile: "huge" });
    expect(result.success).toBe(false);
  });
});

describe("createPythonSandboxTool", () => {
  it("exposes the reserved `execute_python` name", () => {
    const tool = createPythonSandboxTool({ backend: makeFakeBackend({}) });
    expect(tool.name).toBe("execute_python");
  });

  it("invokes the backend with code and a generated executionId", async () => {
    const capture: { request?: SandboxRequest; executionId?: string } = {};
    const tool = createPythonSandboxTool({ backend: makeFakeBackend(capture) });
    const result = await tool.invoke({ code: "print('hi')" });
    expect(capture.request?.code).toBe("print('hi')");
    expect(capture.request?.resourceProfile).toBe("sandbox-small");
    expect(capture.executionId).toMatch(/^exec-/);
    expect(result.status).toBe("succeeded");
    expect(result.backend).toBe("fake");
  });

  it("lets the caller override the default profile", async () => {
    const capture: { request?: SandboxRequest } = {};
    const tool = createPythonSandboxTool({
      backend: makeFakeBackend(capture),
      defaultResourceProfile: "sandbox-large",
    });
    await tool.invoke({ code: "x" });
    expect(capture.request?.resourceProfile).toBe("sandbox-large");
  });

  it("lets the caller override the profile per-call", async () => {
    const capture: { request?: SandboxRequest } = {};
    const tool = createPythonSandboxTool({
      backend: makeFakeBackend(capture),
      defaultResourceProfile: "sandbox-small",
    });
    await tool.invoke({ code: "x", resourceProfile: "sandbox-medium" });
    expect(capture.request?.resourceProfile).toBe("sandbox-medium");
  });
});
