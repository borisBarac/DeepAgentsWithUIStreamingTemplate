import { describe, expect, it } from "bun:test";

import type {
  SandboxBackend,
  SandboxBackendCapabilities,
  SandboxExecutionId,
  SandboxResult,
} from "./types.ts";

/**
 * Shared acceptance suite that every backend must pass. Calling
 * `describeSandboxBackend(...)` in a `*.test.ts` next to a backend
 * implementation proves the backend honors the contract — and that any future
 * backend (cloud-run, hosted) does too.
 *
 * Per-capability skips (e.g. for network denial on a no-isolation backend)
 * happen inside each test based on the actual `capabilities` reported.
 */
export function describeSandboxBackend(
  backendLabel: string,
  factory: () => SandboxBackend | Promise<SandboxBackend>,
  options: {
    readonly skipIf?: () => boolean;
    /** Per-test timeout override. Defaults to 5s (bun:test default). */
    readonly timeoutMs?: number;
  } = {},
): void {
  const globallySkipped = options.skipIf?.() ?? false;
  const timeout = options.timeoutMs;
  let cachedBackend: SandboxBackend | undefined;
  let cachedCapabilities: SandboxBackendCapabilities | undefined;

  const getBackend = async (): Promise<SandboxBackend> => {
    if (!cachedBackend) {
      cachedBackend = await factory();
      cachedCapabilities = cachedBackend.capabilities;
    }
    return cachedBackend;
  };

  const caps = (): SandboxBackendCapabilities | undefined => cachedCapabilities;

  const t = (name: string, fn: () => Promise<void> | void) =>
    timeout !== undefined
      ? it.skipIf(globallySkipped)(name, fn, timeout)
      : it.skipIf(globallySkipped)(name, fn);

  describe(`backend: ${backendLabel}`, () => {
    t("exposes a name, capabilities, and an execute function", async () => {
      const backend = await getBackend();
      expect(typeof backend.execute).toBe("function");
      expect(typeof backend.name).toBe("string");
      expect(typeof caps()?.isolation).toBe("string");
    });

    t("runs hello world and returns succeeded with captured stdout", async () => {
      const backend = await getBackend();
      const result = await backend.execute(
        { code: 'print("hello world")' },
        { executionId: makeExecutionId() },
      );
      expectSandboxResultShape(result);
      expect(result.status).toBe("succeeded");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("hello world");
      expect(result.stdoutTruncated).toBe(false);
      expect(result.stderrTruncated).toBe(false);
      expect(result.retryable).toBe(false);
      expect(result.failureClass).toBeUndefined();
    });

    t("classifies a raised exception as python_exception", async () => {
      const backend = await getBackend();
      const result = await backend.execute(
        { code: "raise ValueError('boom')" },
        { executionId: makeExecutionId() },
      );
      expect(result.status).toBe("failed");
      expect(result.failureClass).toBe("python_exception");
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("Traceback");
      expect(result.stderr).toContain("ValueError");
      expect(result.stderr).toContain("boom");
      expect(result.retryable).toBe(false);
    });

    t("classifies a nonzero exit without traceback as nonzero_exit", async () => {
      const backend = await getBackend();
      const result = await backend.execute(
        { code: "import sys; sys.exit(7)" },
        { executionId: makeExecutionId() },
      );
      expect(result.status).toBe("failed");
      expect(result.failureClass).toBe("nonzero_exit");
      expect(result.exitCode).toBe(7);
      expect(result.retryable).toBe(true);
    });

    t("times out and reports retryable timeout status", async () => {
      const backend = await getBackend();
      const startedAt = Date.now();
      const result = await backend.execute(
        { code: "import time; time.sleep(30)", timeoutSeconds: 1 },
        { executionId: makeExecutionId() },
      );
      const elapsed = Date.now() - startedAt;
      expect(result.status).toBe("timeout");
      expect(result.failureClass).toBe("timeout");
      expect(result.retryable).toBe(true);
      // Should not wait the full 30s sleep.
      expect(elapsed).toBeLessThan(15_000);
    });

    t("truncates stdout above the profile cap and flags it", async () => {
      const backend = await getBackend();
      const result = await backend.execute(
        // 4 chars per print + newline = ~5 bytes; print 50_000 lines ≈ 250 KiB.
        { code: "[print('abcd') for _ in range(50_000)]", resourceProfile: "sandbox-small" },
        { executionId: makeExecutionId() },
      );
      expect(result.stdoutTruncated).toBe(true);
      // Cap is 64 KiB; allow slack for buffer boundaries.
      expect(result.stdout.length).toBeLessThanOrEqual(70_000);
    });

    t("passes stdin to the executed code", async () => {
      const backend = await getBackend();
      const result = await backend.execute(
        {
          code: "import sys; data = sys.stdin.read(); print('got:' + data.strip())",
          stdin: "  payload  ",
        },
        { executionId: makeExecutionId() },
      );
      expect(result.status).toBe("succeeded");
      expect(result.stdout).toContain("got:payload");
    });

    t("passes argv to the executed code", async () => {
      const backend = await getBackend();
      const result = await backend.execute(
        { code: "import sys; print('argv:', sys.argv[1:])", argv: ["alpha", "beta"] },
        { executionId: makeExecutionId() },
      );
      expect(result.status).toBe("succeeded");
      expect(result.stdout).toContain("argv: ['alpha', 'beta']");
    });

    t("captures files written to the workspace as artifacts", async () => {
      const backend = await getBackend();
      if (!caps()?.supportsArtifacts) return;
      const result = await backend.execute(
        {
          code: [
            "import os",
            "os.makedirs('out/sub', exist_ok=True)",
            "with open('out/result.txt','w') as f: f.write('hello')",
            "with open('out/sub/nested.bin','wb') as f: f.write(bytes([1,2,3]))",
          ].join("\n"),
          resourceProfile: "sandbox-medium",
        },
        { executionId: makeExecutionId() },
      );
      expect(result.status).toBe("succeeded");
      const names = result.artifacts.map((a) => a.name).sort();
      expect(names).toContain("out/result.txt");
      expect(names).toContain("out/sub/nested.bin");
      const text = result.artifacts.find((a) => a.name === "out/result.txt");
      const binary = result.artifacts.find((a) => a.name === "out/sub/nested.bin");
      expect(text && new TextDecoder().decode(text.bytes)).toBe("hello");
      expect(binary && Array.from(binary.bytes)).toEqual([1, 2, 3]);
    });

    t("rejects path-traversal input artifact names with validation_error", async () => {
      const backend = await getBackend();
      if (!caps()?.supportsArtifacts) return;
      const inputs = new Map<string, Uint8Array>([
        ["../escape.txt", new TextEncoder().encode("x")],
      ]);
      const result = await backend.execute(
        { code: "print('unused')", inputArtifacts: inputs },
        { executionId: makeExecutionId() },
      );
      expect(result.status).toBe("failed");
      expect(result.failureClass).toBe("validation_error");
      expect(result.retryable).toBe(false);
    });

    t("denies network access to the executed code", async () => {
      const backend = await getBackend();
      if (caps()?.isolation === "none") return;
      const result = await backend.execute(
        {
          code: [
            "import urllib.request, sys",
            "try:",
            "    urllib.request.urlopen('https://example.com', timeout=3)",
            "    print('NETWORK_OK')",
            "except Exception as e:",
            "    print('NETWORK_DENIED:', type(e).__name__)",
            "    sys.exit(0)",
          ].join("\n"),
        },
        { executionId: makeExecutionId() },
      );
      expect(result.status).toBe("succeeded");
      // Must NOT print NETWORK_OK — if it did, isolation failed.
      expect(result.stdout).not.toContain("NETWORK_OK");
      expect(result.stdout).toContain("NETWORK_DENIED");
    });

    t("cancels an in-flight execution via AbortSignal", async () => {
      const backend = await getBackend();
      if (!caps()?.supportsAbort) return;
      const controller = new AbortController();
      const execPromise = backend.execute(
        { code: "import time; time.sleep(30)", timeoutSeconds: 30 },
        { executionId: makeExecutionId(), signal: controller.signal },
      );
      await Bun.sleep(100);
      controller.abort();
      const result = await execPromise;
      expect(result.status).toBe("cancelled");
      expect(result.retryable).toBe(false);
    });

    t("uses a fresh workspace per execution (no leaked files)", async () => {
      const backend = await getBackend();
      const first = await backend.execute(
        {
          code: "with open('leftover.txt','w') as f: f.write('first')",
          resourceProfile: "sandbox-small",
        },
        { executionId: makeExecutionId() },
      );
      expect(first.status).toBe("succeeded");
      const second = await backend.execute(
        {
          code: ["import os", "files = sorted(os.listdir('.'))", "print('FILES:', files)"].join(
            "\n",
          ),
          resourceProfile: "sandbox-small",
        },
        { executionId: makeExecutionId() },
      );
      expect(second.status).toBe("succeeded");
      expect(second.stdout).toContain("FILES:");
      expect(second.stdout).not.toContain("leftover.txt");
    });
  });
}

function makeExecutionId(): SandboxExecutionId {
  return `test-${crypto.randomUUID()}`;
}

function expectSandboxResultShape(result: SandboxResult): void {
  expect(typeof result.executionId).toBe("string");
  expect(typeof result.backend).toBe("string");
  expect(typeof result.startedAt).toBe("string");
  expect(typeof result.finishedAt).toBe("string");
  expect(Number.isFinite(result.durationMs)).toBe(true);
  expect(typeof result.stdout).toBe("string");
  expect(typeof result.stderr).toBe("string");
  expect(Array.isArray(result.artifacts)).toBe(true);
  expect(typeof result.retryable).toBe("boolean");
  expect(typeof result.resourceProfile).toBe("string");
}
