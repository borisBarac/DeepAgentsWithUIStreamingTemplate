import { describe, expect, it } from "bun:test";
import type {
  SandboxBackend,
  SandboxExecuteOptions,
  SandboxRequest,
  SandboxResult,
} from "@deep-agent-template/sandbox";
import { context, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { createPythonSandboxTool, pythonSandboxInputSchema } from "./tool.ts";

function makeFakeBackend(capture: {
  request?: SandboxRequest;
  executionId?: string;
  options?: SandboxExecuteOptions;
}): SandboxBackend {
  return {
    name: "fake",
    capabilities: { isolation: "none", supportsArtifacts: false, supportsAbort: false },
    async execute(request: SandboxRequest, options): Promise<SandboxResult> {
      capture.request = request;
      capture.executionId = options.executionId;
      capture.options = options;
      return {
        executionId: options.executionId,
        identity: options.identity,
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
  it("requires exactly one runtime identity mode", () => {
    expect(() =>
      createPythonSandboxTool({
        backend: makeFakeBackend({}),
      } as never),
    ).toThrow("requires exactly one");
    expect(() =>
      createPythonSandboxTool({
        backend: makeFakeBackend({}),
        identity: { tenantId: "acme", userId: "alice" },
        singleUser: true,
      } as never),
    ).toThrow("requires exactly one");
    expect(() =>
      createPythonSandboxTool({
        backend: makeFakeBackend({}),
        identity: { tenantId: "", userId: "alice" },
      }),
    ).toThrow("requires non-empty");
  });

  it("exposes the reserved `execute_python` name", () => {
    const tool = createPythonSandboxTool({ backend: makeFakeBackend({}), singleUser: true });
    expect(tool.name).toBe("execute_python");
  });

  it("invokes the backend with code and a generated executionId", async () => {
    const capture: { request?: SandboxRequest; executionId?: string } = {};
    const tool = createPythonSandboxTool({ backend: makeFakeBackend(capture), singleUser: true });
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
      singleUser: true,
      defaultResourceProfile: "sandbox-large",
    });
    await tool.invoke({ code: "x" });
    expect(capture.request?.resourceProfile).toBe("sandbox-large");
  });

  it("lets the caller override the profile per-call", async () => {
    const capture: { request?: SandboxRequest } = {};
    const tool = createPythonSandboxTool({
      backend: makeFakeBackend(capture),
      singleUser: true,
      defaultResourceProfile: "sandbox-small",
    });
    await tool.invoke({ code: "x", resourceProfile: "sandbox-medium" });
    expect(capture.request?.resourceProfile).toBe("sandbox-medium");
  });

  it("forwards caller identity into the backend execute options", async () => {
    const capture: { options?: SandboxExecuteOptions } = {};
    const tool = createPythonSandboxTool({
      backend: makeFakeBackend(capture),
      identity: { tenantId: "acme", userId: "alice" },
    });
    await tool.invoke({ code: "x" });
    expect(capture.options?.identity).toEqual({ tenantId: "acme", userId: "alice" });
  });

  it("omits identity when none is configured", async () => {
    const capture: { options?: SandboxExecuteOptions } = {};
    const tool = createPythonSandboxTool({ backend: makeFakeBackend(capture), singleUser: true });
    await tool.invoke({ code: "x" });
    expect(capture.options?.identity).toBeUndefined();
  });

  it("emits a sandbox.execute_python span nested under the active parent", async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    // A context manager is required for context.active() to propagate across
    // the context.with boundary (the production web-app registers one via
    // sdk-node; this test registers one directly).
    const contextManager = new AsyncLocalStorageContextManager();
    contextManager.enable();
    trace.setGlobalTracerProvider(provider);
    context.setGlobalContextManager(contextManager);
    try {
      const parent = trace.getTracer("test").startSpan("agent.run");
      const parentSpanId = parent.spanContext().spanId;
      await context.with(trace.setSpan(context.active(), parent), async () => {
        const tool = createPythonSandboxTool({
          backend: makeFakeBackend({}),
          identity: { tenantId: "acme", userId: "alice" },
        });
        await tool.invoke({ code: "x", resourceProfile: "sandbox-medium" });
      });
      parent.end();

      const spans = exporter.getFinishedSpans();
      const sandboxSpan = spans.find((s) => s.name === "sandbox.execute_python");
      expect(sandboxSpan).toBeDefined();
      expect(sandboxSpan?.attributes["tenant.id"]).toBe("acme");
      expect(sandboxSpan?.attributes["user.id"]).toBe("alice");
      expect(sandboxSpan?.attributes["sandbox.resource_profile"]).toBe("sandbox-medium");
      expect(sandboxSpan?.attributes["sandbox.status"]).toBe("succeeded");
      // The sandbox span's parent must be the agent.run span we opened.
      expect(sandboxSpan?.parentSpanContext?.spanId).toBe(parentSpanId);
    } finally {
      // Reset to no-op globals so this test's OTel setup doesn't leak.
      context.disable();
      trace.disable();
    }
  });

  it("does not throw and still returns a result with no tracer provider registered", async () => {
    const result = await createPythonSandboxTool({
      backend: makeFakeBackend({}),
      singleUser: true,
    }).invoke({ code: "x" });
    expect(result.status).toBe("succeeded");
  });

  it("discards crossed correlation fields and output", async () => {
    const backend = makeFakeBackend({});
    backend.execute = async () => ({
      executionId: "exec-bob",
      identity: { tenantId: "other", userId: "bob" },
      status: "succeeded",
      exitCode: 0,
      startedAt: "2025-01-01T00:00:00.000Z",
      finishedAt: "2025-01-01T00:00:00.001Z",
      durationMs: 1,
      stdout: "BOB_SECRET",
      stderr: "BOB_ERROR",
      stdoutTruncated: false,
      stderrTruncated: false,
      artifacts: [{ name: "bob.txt", bytes: new Uint8Array([66]) }],
      retryable: false,
      resourceProfile: "sandbox-small",
      backend: "fake",
    });
    const result = await createPythonSandboxTool({
      backend,
      identity: { tenantId: "acme", userId: "alice" },
    }).invoke({ code: "x" });

    expect(result.status).toBe("internal_error");
    expect(result.failureClass).toBe("result_mismatch");
    expect(result.executionId).toMatch(/^exec-/);
    expect(result.identity).toEqual({ tenantId: "acme", userId: "alice" });
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.artifacts).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("BOB");
    expect(result.retryable).toBe(false);
  });

  it("rejects missing identity correlation fields", async () => {
    const delegate = makeFakeBackend({});
    const backend = makeFakeBackend({});
    backend.execute = async (request, options) => ({
      ...(await delegate.execute(request, options)),
      identity: undefined,
    });
    const result = await createPythonSandboxTool({
      backend,
      identity: { tenantId: "acme", userId: "alice" },
    }).invoke({ code: "x" });
    expect(result.failureClass).toBe("result_mismatch");
  });

  it("rejects a missing execution ID correlation field", async () => {
    const delegate = makeFakeBackend({});
    const backend = makeFakeBackend({});
    backend.execute = async (request, options) =>
      ({
        ...(await delegate.execute(request, options)),
        executionId: undefined,
      }) as unknown as SandboxResult;
    const result = await createPythonSandboxTool({
      backend,
      identity: { tenantId: "acme", userId: "alice" },
    }).invoke({ code: "x" });
    expect(result.status).toBe("internal_error");
    expect(result.failureClass).toBe("result_mismatch");
    expect(result.executionId).toMatch(/^exec-/);
  });

  it("converts backend exceptions and lets the caller continue", async () => {
    const delegate = makeFakeBackend({});
    const backend = makeFakeBackend({});
    let attempts = 0;
    backend.execute = async (request, options) => {
      attempts += 1;
      if (attempts === 1) throw new Error("docker leaked secret details");
      return delegate.execute(request, options);
    };
    const sandboxTool = createPythonSandboxTool({ backend, singleUser: true });
    const result = await sandboxTool.invoke({
      code: "x",
    });
    expect(result.status).toBe("internal_error");
    expect(result.failureClass).toBe("internal_error");
    expect(result.failureMessage).toBe("Sandbox execution failed internally.");
    expect(JSON.stringify(result)).not.toContain("leaked secret");
    expect(result.retryable).toBe(true);

    const continuedResult = await sandboxTool.invoke({ code: "print('continued')" });
    expect(continuedResult.status).toBe("succeeded");
    expect(attempts).toBe(2);
  });
});
