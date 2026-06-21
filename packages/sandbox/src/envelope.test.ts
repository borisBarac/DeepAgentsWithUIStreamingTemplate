import { describe, expect, it } from "bun:test";

import {
  buildResultEnvelope,
  classifyFailure,
  collectStream,
  looksLikePythonTraceback,
  structuredLogLine,
} from "./envelope.ts";

function streamOf(bytes: Uint8Array, chunkSize: number): ReadableStream<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < bytes.byteLength; i += chunkSize) {
    chunks.push(bytes.subarray(i, Math.min(i + chunkSize, bytes.byteLength)));
  }
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

function encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

describe("collectStream", () => {
  it("returns empty for a null stream", async () => {
    const result = await collectStream(null, 100);
    expect(result.value).toBe("");
    expect(result.truncated).toBe(false);
    expect(result.byteLength).toBe(0);
  });

  it("collects a short stream without truncation", async () => {
    const result = await collectStream(streamOf(encode("hello world"), 4), 100);
    expect(result.value).toBe("hello world");
    expect(result.truncated).toBe(false);
    expect(result.byteLength).toBe(11);
  });

  it("truncates exactly at the byte cap and sets the flag", async () => {
    const data = encode("abcdefghijklmnopqrstuvwxyz");
    const result = await collectStream(streamOf(data, 4), 10);
    expect(result.byteLength).toBe(10);
    expect(result.truncated).toBe(true);
    expect(result.value).toBe("abcdefghij");
  });

  it("handles chunk boundaries larger than remaining cap", async () => {
    const data = encode("0123456789ABCDEF");
    const result = await collectStream(streamOf(data, 8), 10);
    expect(result.byteLength).toBe(10);
    expect(result.truncated).toBe(true);
    expect(result.value).toBe("0123456789");
  });

  it("decodes multibyte UTF-8 without throwing", async () => {
    const data = encode("héllo 🌍 world");
    const result = await collectStream(streamOf(data, 3), 8);
    expect(result.truncated).toBe(true);
    // exact prefix depends on byte boundary; just ensure it doesn't throw
    expect(result.byteLength).toBeLessThanOrEqual(8);
  });
});

describe("looksLikePythonTraceback", () => {
  it("detects the standard traceback header", () => {
    expect(looksLikePythonTraceback("Traceback (most recent call last):\n  File...")).toBe(true);
  });
  it("returns false for ordinary stderr", () => {
    expect(looksLikePythonTraceback("some warning\n")).toBe(false);
  });
});

describe("classifyFailure", () => {
  it("prioritizes abort over timeout", () => {
    const result = classifyFailure({
      aborted: true,
      timedOut: true,
      exitCode: null,
      stderr: "",
    });
    expect(result.status).toBe("cancelled");
    expect(result.failureClass).toBeUndefined();
    expect(result.retryable).toBe(false);
  });

  it("treats timeout as retryable", () => {
    const result = classifyFailure({
      aborted: false,
      timedOut: true,
      exitCode: null,
      stderr: "",
    });
    expect(result.status).toBe("timeout");
    expect(result.failureClass).toBe("timeout");
    expect(result.retryable).toBe(true);
  });

  it("classifies start failure with image keywords as image_pull_failed", () => {
    const result = classifyFailure({
      aborted: false,
      timedOut: false,
      startFailed: true,
      startFailedMessage: "Unable to find image locally: pull failed",
      exitCode: null,
      stderr: "",
    });
    expect(result.status).toBe("internal_error");
    expect(result.failureClass).toBe("image_pull_failed");
    expect(result.retryable).toBe(true);
  });

  it("classifies generic start failure as job_start_failed", () => {
    const result = classifyFailure({
      aborted: false,
      timedOut: false,
      startFailed: true,
      startFailedMessage: "docker daemon not running",
      exitCode: null,
      stderr: "",
    });
    expect(result.status).toBe("internal_error");
    expect(result.failureClass).toBe("job_start_failed");
    expect(result.retryable).toBe(true);
  });

  it("treats exit 0 as succeeded with no failure class", () => {
    const result = classifyFailure({
      aborted: false,
      timedOut: false,
      exitCode: 0,
      stderr: "",
    });
    expect(result.status).toBe("succeeded");
    expect(result.failureClass).toBeUndefined();
    expect(result.retryable).toBe(false);
  });

  it("classifies a Python traceback as python_exception (non-retryable)", () => {
    const result = classifyFailure({
      aborted: false,
      timedOut: false,
      exitCode: 1,
      stderr: "Traceback (most recent call last):\nValueError: boom",
    });
    expect(result.status).toBe("failed");
    expect(result.failureClass).toBe("python_exception");
    expect(result.retryable).toBe(false);
  });

  it("classifies a nonzero exit without traceback as nonzero_exit (retryable)", () => {
    const result = classifyFailure({
      aborted: false,
      timedOut: false,
      exitCode: 7,
      stderr: "some output",
    });
    expect(result.status).toBe("failed");
    expect(result.failureClass).toBe("nonzero_exit");
    expect(result.retryable).toBe(true);
  });

  it("falls back to internal_error on null exit code with no other signal", () => {
    const result = classifyFailure({
      aborted: false,
      timedOut: false,
      exitCode: null,
      stderr: "",
    });
    expect(result.status).toBe("internal_error");
    expect(result.failureClass).toBe("internal_error");
    expect(result.retryable).toBe(false);
  });
});

describe("buildResultEnvelope", () => {
  it("assembles the envelope and computes duration", () => {
    const startedAt = new Date("2025-01-01T00:00:00.000Z");
    const finishedAt = new Date("2025-01-01T00:00:01.500Z");
    const result = buildResultEnvelope({
      executionId: "exec-1",
      resourceProfile: "sandbox-small",
      backend: "test",
      startedAt,
      finishedAt,
      exitCode: 0,
      stdout: { value: "hi", truncated: false, byteLength: 2 },
      stderr: { value: "", truncated: false, byteLength: 0 },
      artifacts: [],
      classification: { status: "succeeded", retryable: false },
    });
    expect(result.executionId).toBe("exec-1");
    expect(result.startedAt).toBe(startedAt.toISOString());
    expect(result.finishedAt).toBe(finishedAt.toISOString());
    expect(result.durationMs).toBe(1500);
    expect(result.stdout).toBe("hi");
    expect(result.stdoutTruncated).toBe(false);
    expect(result.backend).toBe("test");
    expect(result.resourceProfile).toBe("sandbox-small");
  });
});

describe("structuredLogLine", () => {
  it("produces parseable JSON without code or stdout", () => {
    const line = structuredLogLine({
      executionId: "exec-1",
      backend: "test",
      resourceProfile: "sandbox-small",
      status: "succeeded",
      exitCode: 0,
      durationMs: 100,
      stdoutBytes: 5,
      stderrBytes: 0,
      artifactCount: 0,
    });
    const parsed = JSON.parse(line);
    expect(parsed.executionId).toBe("exec-1");
    expect(parsed.component).toBe("sandbox");
    expect("code" in parsed).toBe(false);
    expect("stdout" in parsed).toBe(false);
    expect("stdin" in parsed).toBe(false);
  });
});
