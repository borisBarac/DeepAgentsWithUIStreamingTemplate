import type {
  SandboxArtifact,
  SandboxExecutionId,
  SandboxExecutionIdentity,
  SandboxFailureClass,
  SandboxResourceProfile,
  SandboxResult,
  SandboxStatus,
} from "./types.ts";

/**
 * Result of collecting a stdout/stderr stream up to a byte cap. `value` holds
 * the decoded text (UTF-8); `truncated` is true if the cap was hit.
 */
export type CollectedOutput = {
  readonly value: string;
  readonly truncated: boolean;
  readonly byteLength: number;
};

/**
 * Collect a binary stream up to `maxBytes`, then mark truncated and stop
 * reading (but keep draining the underlying stream so the producer doesn't
 * block forever on a full pipe). Decodes accumulated bytes as UTF-8.
 *
 * `TextDecoder` is created with `fatal: false` so partial multibyte sequences
 * at the cap boundary don't throw — they're replaced with the U+FFFD
 * replacement character.
 */
export async function collectStream(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<CollectedOutput> {
  if (!stream) {
    return { value: "", truncated: false, byteLength: 0 };
  }
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }
      if (truncated) {
        continue;
      }
      const remaining = maxBytes - total;
      if (remaining <= 0) {
        truncated = true;
        continue;
      }
      if (value.byteLength <= remaining) {
        chunks.push(value);
        total += value.byteLength;
      } else {
        chunks.push(value.subarray(0, remaining));
        total = maxBytes;
        truncated = true;
      }
    }
  } finally {
    reader.releaseLock();
  }

  const merged = mergeBytes(chunks);
  const decoder = new TextDecoder("utf-8", { fatal: false });
  return {
    value: decoder.decode(merged, { stream: false }),
    truncated,
    byteLength: merged.byteLength,
  };
}

function mergeBytes(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 0) {
    return new Uint8Array(0);
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

/**
 * Detection helper: returns true if stderr looks like a Python traceback.
 * Used by {@link classifyFailure} to distinguish `python_exception` from
 * generic `nonzero_exit`.
 */
export function looksLikePythonTraceback(stderr: string): boolean {
  return (
    stderr.includes("Traceback (most recent call last)") ||
    stderr.includes("Traceback (most recent)")
  );
}

export type FailureClassification = {
  readonly status: SandboxStatus;
  readonly failureClass?: SandboxFailureClass;
  readonly retryable: boolean;
};

/**
 * Classify the terminal state of a process into the spec §20 taxonomy.
 *
 * Priority:
 *  1. Abort signal → `cancelled` (caller-initiated).
 *  2. Timeout fired → `timeout`.
 *  3. Backend failed to start the process → `job_start_failed` (or
 *     `image_pull_failed` if the failure looks like an image fetch error).
 *  4. Process exited 0 → `succeeded` (no failure class).
 *  5. Process exited non-zero with a traceback → `python_exception`.
 *  6. Process exited non-zero otherwise → `nonzero_exit`.
 *  7. Fallback → `internal_error`.
 */
export function classifyFailure(input: {
  readonly aborted: boolean;
  readonly timedOut: boolean;
  readonly startFailed?: boolean;
  readonly startFailedMessage?: string;
  readonly exitCode: number | null;
  readonly stderr: string;
}): FailureClassification {
  if (input.aborted) {
    return { status: "cancelled", failureClass: undefined, retryable: false };
  }
  if (input.timedOut) {
    return { status: "timeout", failureClass: "timeout", retryable: true };
  }
  if (input.startFailed) {
    const message = input.startFailedMessage ?? "";
    if (message.includes("image") && (message.includes("pull") || message.includes("manifest"))) {
      return { status: "internal_error", failureClass: "image_pull_failed", retryable: true };
    }
    return { status: "internal_error", failureClass: "job_start_failed", retryable: true };
  }
  if (input.exitCode === null) {
    return { status: "internal_error", failureClass: "internal_error", retryable: false };
  }
  if (input.exitCode === 0) {
    return { status: "succeeded", failureClass: undefined, retryable: false };
  }
  if (looksLikePythonTraceback(input.stderr)) {
    return { status: "failed", failureClass: "python_exception", retryable: false };
  }
  return { status: "failed", failureClass: "nonzero_exit", retryable: true };
}

/**
 * Assemble the final {@link SandboxResult} envelope from collected outputs
 * and a failure classification. Timestamps are rendered as ISO 8601 strings.
 */
export function buildResultEnvelope(input: {
  readonly executionId: SandboxExecutionId;
  readonly resourceProfile: SandboxResourceProfile;
  readonly backend: string;
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly exitCode: number | null;
  readonly stdout: CollectedOutput;
  readonly stderr: CollectedOutput;
  readonly artifacts: readonly SandboxArtifact[];
  readonly classification: FailureClassification;
  readonly failureMessage?: string;
}): SandboxResult {
  return {
    executionId: input.executionId,
    status: input.classification.status,
    exitCode: input.exitCode,
    startedAt: input.startedAt.toISOString(),
    finishedAt: input.finishedAt.toISOString(),
    durationMs: Math.max(0, input.finishedAt.getTime() - input.startedAt.getTime()),
    stdout: input.stdout.value,
    stderr: input.stderr.value,
    stdoutTruncated: input.stdout.truncated,
    stderrTruncated: input.stderr.truncated,
    artifacts: input.artifacts,
    failureClass: input.classification.failureClass,
    failureMessage: input.failureMessage,
    retryable: input.classification.retryable,
    resourceProfile: input.resourceProfile,
    backend: input.backend,
  };
}

/**
 * Produce a one-line structured JSON log entry for an execution. Never includes
 * code, stdin, or full stdout/stderr — only byte counts and metadata.
 *
 * Spec §16.1.
 */
export function structuredLogLine(input: {
  readonly executionId: SandboxExecutionId;
  readonly backend: string;
  readonly resourceProfile: SandboxResourceProfile;
  readonly status: SandboxStatus;
  readonly failureClass?: SandboxFailureClass;
  readonly exitCode: number | null;
  readonly durationMs: number;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly artifactCount: number;
  readonly identity?: SandboxExecutionIdentity;
}): string {
  const payload: Record<string, unknown> = {
    ts: new Date().toISOString(),
    component: "sandbox",
    executionId: input.executionId,
    backend: input.backend,
    resourceProfile: input.resourceProfile,
    status: input.status,
    failureClass: input.failureClass,
    exitCode: input.exitCode,
    durationMs: input.durationMs,
    stdoutBytes: input.stdoutBytes,
    stderrBytes: input.stderrBytes,
    artifactCount: input.artifactCount,
  };
  if (input.identity) {
    payload.tenantId = input.identity.tenantId;
    payload.userId = input.identity.userId;
  }
  return JSON.stringify(payload);
}
