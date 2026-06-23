import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { ENTRYPOINT_FILENAME } from "../constants.ts";
import {
  buildResultEnvelope,
  classifyFailure,
  collectStream,
  structuredLogLine,
} from "../envelope.ts";
import {
  assertValidArtifactName,
  resolveSandboxProfile,
  SandboxValidationError,
} from "../profiles.ts";
import type {
  SandboxArtifact,
  SandboxExecuteOptions,
  SandboxFailureClass,
  SandboxRequest,
  SandboxResourceProfileConfig,
  SandboxResult,
} from "../types.ts";

/**
 * Shared pipeline and utilities used by every sandbox backend. Extracted so
 * that each backend only has to supply its spawn command and (optionally) a
 * kill strategy, a pre-flight check, and a start-failure sniffer. Everything
 * else — race semantics, output collection, failure classification, envelope
 * construction, logging, workspace setup, cleanup — is identical across
 * backends and lives here.
 */

/** Bun subprocess with all three stdio streams piped. */
export type SandboxProcess = import("bun").Subprocess<"pipe", "pipe", "pipe">;

/** Result of a backend's spawn callback: the running process plus a kill handle. */
export type SpawnResult = {
  readonly proc: SandboxProcess;
  /** Kill the process/container. Called on timeout or abort. Best-effort. */
  readonly kill: () => void | Promise<void>;
};

/** Failure descriptor returned by `describeStartFailure` sniffers. */
export type StartFailure = {
  readonly failureClass: SandboxFailureClass;
  readonly message: string;
};

/** Classification tuple used by `buildSyntheticResult`. */
export type SyntheticClassification = {
  readonly status: SandboxResult["status"];
  readonly failureClass: SandboxFailureClass;
  readonly retryable: boolean;
};

/**
 * Build a `SandboxResult` envelope for an error that terminated the execution
 * before (or instead of) running the user's code. Used by every error path
 * in {@link executeWithHandling} and {@link runExecution}.
 */
export function buildSyntheticResult(args: {
  readonly executionId: string;
  readonly resourceProfile: SandboxRequest["resourceProfile"];
  readonly backend: string;
  readonly startedAt: Date;
  readonly error: unknown;
  readonly classification: SyntheticClassification;
}): SandboxResult {
  const message = args.error instanceof Error ? args.error.message : String(args.error);
  return buildResultEnvelope({
    executionId: args.executionId,
    resourceProfile: args.resourceProfile ?? "sandbox-small",
    backend: args.backend,
    startedAt: args.startedAt,
    finishedAt: new Date(),
    exitCode: null,
    stdout: { value: "", truncated: false, byteLength: 0 },
    stderr: { value: "", truncated: false, byteLength: 0 },
    artifacts: [],
    classification: args.classification,
    failureMessage: message,
  });
}

/**
 * The outer skeleton of `SandboxBackend.execute`: resolve profile → optional
 * pre-check → create workspace → run → cleanup. Every error path returns a
 * synthetic envelope so the tool layer never sees an exception.
 *
 * Backend-specific behavior is supplied via callbacks:
 *  - `preWorkspaceCheck` — return a result envelope to short-circuit (e.g.
 *    docker-unavailable), or `undefined` to continue.
 *  - `createWorkspaceOptions` — chmod flags for the in-container user.
 *  - `run` — the inner pipeline (typically just calls {@link runExecution}).
 *  - `cleanup` — extra cleanup after the workspace is removed (e.g. killing a
 *    lingering container).
 */
export async function executeWithHandling(args: {
  readonly backendName: string;
  readonly request: SandboxRequest;
  readonly execOptions: SandboxExecuteOptions;
  readonly workDirRoot: string;
  readonly createWorkspaceOptions?: { readonly chmodForContainerUser?: boolean };
  readonly preWorkspaceCheck?: (
    config: SandboxResourceProfileConfig,
  ) => Promise<SandboxResult | undefined>;
  readonly run: (ctx: {
    readonly config: SandboxResourceProfileConfig;
    readonly timeoutSeconds: number;
    readonly workDir: string;
    readonly startedAt: Date;
  }) => Promise<SandboxResult>;
  readonly cleanup?: () => Promise<void> | void;
}): Promise<SandboxResult> {
  const startedAt = new Date();

  let config: SandboxResourceProfileConfig;
  let timeoutSeconds: number;
  try {
    const resolved = resolveSandboxProfile(args.request);
    config = resolved.config;
    timeoutSeconds = resolved.timeoutSeconds;
  } catch (error) {
    return buildSyntheticResult({
      executionId: args.execOptions.executionId,
      resourceProfile: args.request.resourceProfile ?? "sandbox-small",
      backend: args.backendName,
      startedAt,
      error,
      classification: { status: "failed", failureClass: "validation_error", retryable: false },
    });
  }

  if (args.preWorkspaceCheck) {
    const earlyExit = await args.preWorkspaceCheck(config);
    if (earlyExit) return earlyExit;
  }

  let workDir: string;
  try {
    workDir = await createWorkspace(args.workDirRoot, args.request, args.createWorkspaceOptions);
  } catch (error) {
    const isValidation = error instanceof SandboxValidationError;
    return buildSyntheticResult({
      executionId: args.execOptions.executionId,
      resourceProfile: config.profile,
      backend: args.backendName,
      startedAt,
      error,
      classification: isValidation
        ? { status: "failed", failureClass: "validation_error", retryable: false }
        : { status: "internal_error", failureClass: "internal_error", retryable: false },
    });
  }

  try {
    return await args.run({ config, timeoutSeconds, workDir, startedAt });
  } finally {
    await safeRm(workDir);
    if (args.cleanup) await args.cleanup();
  }
}

/**
 * The inner execution pipeline: spawn → write stdin → race(exit, timeout,
 * abort) → collect streams → collect artifacts → classify → envelope → log.
 *
 * Backends supply `spawn` (which also returns a `kill` handle) and optionally
 * `describeStartFailure` to inspect stderr for backend-specific start
 * failures (e.g. docker image pull errors).
 */
export async function runExecution(args: {
  readonly backendName: string;
  readonly request: SandboxRequest;
  readonly execOptions: SandboxExecuteOptions;
  readonly workDir: string;
  readonly config: SandboxResourceProfileConfig;
  readonly timeoutSeconds: number;
  readonly startedAt: Date;
  readonly spawn: () => SpawnResult | Promise<SpawnResult>;
  readonly describeStartFailure?: (stderr: string) => StartFailure | undefined;
}): Promise<SandboxResult> {
  const { backendName, request, execOptions, workDir, config, timeoutSeconds, startedAt } = args;

  let spawnResult: SpawnResult;
  try {
    spawnResult = await args.spawn();
  } catch (error) {
    return buildSyntheticResult({
      executionId: execOptions.executionId,
      resourceProfile: config.profile,
      backend: backendName,
      startedAt,
      error,
      classification: {
        status: "internal_error",
        failureClass: "job_start_failed",
        retryable: true,
      },
    });
  }
  const { proc, kill } = spawnResult;

  if (request.stdin !== undefined && proc.stdin) {
    try {
      proc.stdin.write(request.stdin);
      proc.stdin.end();
    } catch {
      // ignore broken pipe
    }
  }

  const timedOut = { value: false };
  const aborted = { value: false };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;

  const timeoutMs = timeoutSeconds * 1000;
  const timeoutPromise = new Promise<"timeout">((resolveTimeout) => {
    timer = setTimeout(() => {
      timedOut.value = true;
      void safeCall(kill);
      resolveTimeout("timeout");
    }, timeoutMs);
  });

  const abortPromise = new Promise<"aborted">((resolveAbort) => {
    const signal = execOptions.signal;
    if (!signal) return;
    if (signal.aborted) {
      aborted.value = true;
      void safeCall(kill);
      resolveAbort("aborted");
      return;
    }
    abortListener = () => {
      aborted.value = true;
      void safeCall(kill);
      resolveAbort("aborted");
    };
    signal.addEventListener("abort", abortListener);
  });

  const stdoutPromise = collectStream(proc.stdout, config.maxOutputBytes);
  const stderrPromise = collectStream(proc.stderr, config.maxOutputBytes);

  let exitCode: number | null = null;
  let startFailed = false;
  let startFailedMessage: string | undefined;
  try {
    await Promise.race([
      proc.exited.then((code): "exit" => {
        exitCode = code;
        return "exit";
      }),
      timeoutPromise,
      abortPromise,
    ]);
  } catch (error) {
    startFailed = true;
    startFailedMessage = error instanceof Error ? error.message : String(error);
  }

  if (timer) clearTimeout(timer);
  if (abortListener && execOptions.signal) {
    execOptions.signal.removeEventListener("abort", abortListener);
  }

  const [stdoutCollected, stderrCollected] = await Promise.all([stdoutPromise, stderrPromise]);
  const artifacts = await collectArtifacts(
    workDir,
    config.maxArtifactCount,
    config.maxArtifactBytes,
    new Set([ENTRYPOINT_FILENAME]),
  );
  const finishedAt = new Date();

  // Backend-specific start-failure sniffing (e.g. docker image pull errors).
  if (
    !startFailed &&
    !timedOut.value &&
    !aborted.value &&
    exitCode !== 0 &&
    args.describeStartFailure
  ) {
    const sniffed = args.describeStartFailure(stderrCollected.value);
    if (sniffed) {
      startFailed = true;
      startFailedMessage = sniffed.message;
    }
  }

  const classification = classifyFailure({
    aborted: aborted.value,
    timedOut: timedOut.value,
    startFailed,
    startFailedMessage,
    exitCode,
    stderr: stderrCollected.value,
  });

  const result = buildResultEnvelope({
    executionId: execOptions.executionId,
    resourceProfile: config.profile,
    backend: backendName,
    startedAt,
    finishedAt,
    exitCode,
    stdout: stdoutCollected,
    stderr: stderrCollected,
    artifacts,
    classification,
    failureMessage: startFailedMessage,
  });

  console.log(
    structuredLogLine({
      executionId: execOptions.executionId,
      backend: backendName,
      resourceProfile: config.profile,
      status: result.status,
      failureClass: result.failureClass,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      stdoutBytes: stdoutCollected.byteLength,
      stderrBytes: stderrCollected.byteLength,
      artifactCount: artifacts.length,
    }),
  );

  return result;
}

/**
 * Create a fresh per-execution workspace under `workDirRoot`. Writes the
 * Python entrypoint and any input artifacts. When `chmodForContainerUser` is
 * set (docker backend), files are world-readable and the workspace dir is
 * world-writable so the in-container `nobody` user can read inputs and write
 * outputs through the bind mount.
 */
export async function createWorkspace(
  workDirRoot: string,
  request: SandboxRequest,
  options: { readonly chmodForContainerUser?: boolean } = {},
): Promise<string> {
  const workDir = await mkdtemp(join(workDirRoot, "sandbox-"));
  if (options.chmodForContainerUser) {
    await chmod(workDir, 0o777);
  }
  await writeFile(join(workDir, ENTRYPOINT_FILENAME), request.code, "utf-8");
  if (options.chmodForContainerUser) {
    await chmod(join(workDir, ENTRYPOINT_FILENAME), 0o644);
  }
  if (request.inputArtifacts) {
    for (const [name, bytes] of request.inputArtifacts) {
      assertValidArtifactName(name);
      const target = join(workDir, name);
      await mkdir(join(target, ".."), { recursive: true });
      await writeFile(target, bytes);
      if (options.chmodForContainerUser) {
        await chmod(target, 0o644);
      }
    }
  }
  return workDir;
}

/**
 * Collect output artifacts from the workspace, excluding the entrypoint and
 * any input files. Walks the tree recursively, caps file count and per-file
 * bytes, skips unreadable files.
 */
export async function collectArtifacts(
  workDir: string,
  maxCount: number,
  maxBytes: number,
  exclude: Set<string>,
): Promise<SandboxArtifact[]> {
  const out: SandboxArtifact[] = [];
  await walk(workDir, workDir, out, maxCount, maxBytes, exclude);
  return out;
}

/**
 * Build a host environment scrubbed to only the listed keys. Prevents the
 * spawned process (or `docker run` CLI) from inheriting platform secrets.
 */
export function sanitizeEnvForHost(allowList: readonly string[]): NodeJS.ProcessEnv {
  const safe: Partial<NodeJS.ProcessEnv> = {};
  for (const key of allowList) {
    const value = process.env[key];
    if (value !== undefined) safe[key] = value;
  }
  return safe as NodeJS.ProcessEnv;
}

/** Remove a directory tree, swallowing errors. */
export async function safeRm(path: string): Promise<void> {
  try {
    await rm(path, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

/** Invoke a kill callback that may be sync or async, swallowing errors. */
function safeCall(fn: () => void | Promise<void>): void {
  try {
    const result = fn();
    if (result && typeof result.then === "function") {
      result.catch(() => {
        // ignore
      });
    }
  } catch {
    // ignore
  }
}

type DirentLike = {
  readonly name: string;
  isDirectory(): boolean;
  isFile(): boolean;
};

async function walk(
  root: string,
  current: string,
  out: SandboxArtifact[],
  maxCount: number,
  maxBytes: number,
  exclude: Set<string>,
): Promise<void> {
  let entries: ReadonlyArray<DirentLike>;
  try {
    entries = (await readdir(current, { withFileTypes: true })) as ReadonlyArray<DirentLike>;
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= maxCount) return;
    const fullPath = join(current, entry.name);
    const rel = relative(root, fullPath).split("\\").join("/");
    if (entry.isDirectory()) {
      await walk(root, fullPath, out, maxCount, maxBytes, exclude);
    } else if (entry.isFile()) {
      if (exclude.has(rel) || exclude.has(entry.name)) continue;
      try {
        const raw = await readFile(fullPath);
        if (raw.byteLength > maxBytes) continue;
        out.push({ name: rel, bytes: new Uint8Array(raw) });
      } catch {
        // skip unreadable
      }
    }
  }
}
