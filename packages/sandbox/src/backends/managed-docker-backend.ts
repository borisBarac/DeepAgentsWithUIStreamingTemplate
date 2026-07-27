import { chmod, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CONTAINER_WORKSPACE_PATH, DEFAULT_PYTHON_IMAGE } from "../constants.ts";
import type {
  SandboxBackend,
  SandboxExecuteOptions,
  SandboxRequest,
  SandboxResult,
} from "../types.ts";
import { buildSyntheticResult } from "./backend-helpers.ts";
import { createDockerSandboxBackend } from "./docker-backend.ts";

export type ManagedDockerSandboxBackendOptions = {
  readonly containerName: string;
  readonly workspaceRoot?: string;
  readonly image?: string;
  readonly cpus?: string | number;
  readonly memory?: string;
  readonly maxConcurrency?: number;
  readonly queueCapacity?: number;
  readonly dockerBin?: string;
};

export type ManagedDockerSandboxBackend = SandboxBackend & {
  dispose(): Promise<void>;
};

type Admission = {
  acquire(signal?: AbortSignal): Promise<"acquired" | "cancelled" | "full">;
  release(): void;
  dispose(): void;
};

export function createManagedDockerSandboxBackend(
  options: ManagedDockerSandboxBackendOptions,
): ManagedDockerSandboxBackend {
  const maxConcurrency = positiveInteger(options.maxConcurrency ?? 5, "maxConcurrency");
  const queueCapacity = nonNegativeInteger(options.queueCapacity ?? 25, "queueCapacity");
  const dockerBin = options.dockerBin ?? "docker";
  const workspaceRoot =
    options.workspaceRoot ??
    join(tmpdir(), `${options.containerName}-workspace-${process.pid}-${crypto.randomUUID()}`);
  const image = options.image ?? DEFAULT_PYTHON_IMAGE;
  const cpus = String(options.cpus ?? 2.5);
  const memory = options.memory ?? "1280m";

  const delegate = createDockerSandboxBackend({
    containerName: options.containerName,
    dockerBin,
    workDirRoot: workspaceRoot,
  });
  const admission = createAdmissionController(maxConcurrency, queueCapacity);
  let startPromise: Promise<void> | undefined;
  let disposed = false;

  const ensureStarted = async (): Promise<void> => {
    if (disposed) throw new Error("Managed Docker sandbox backend is disposed.");
    startPromise ??= startManagedContainer({
      containerName: options.containerName,
      cpus,
      dockerBin,
      image,
      memory,
      workspaceRoot,
    }).catch((error) => {
      startPromise = undefined;
      throw error;
    });
    await startPromise;
  };

  return {
    name: "docker",
    capabilities: delegate.capabilities,
    async execute(request, execOptions) {
      const admissionResult = await admission.acquire(execOptions.signal);
      if (admissionResult !== "acquired") {
        return admissionFailure(request, execOptions, admissionResult);
      }
      try {
        try {
          await ensureStarted();
        } catch (error) {
          return buildSyntheticResult({
            executionId: execOptions.executionId,
            identity: execOptions.identity,
            resourceProfile: request.resourceProfile ?? "sandbox-small",
            backend: "docker",
            startedAt: new Date(),
            error,
            classification: {
              status: "internal_error",
              failureClass: "job_start_failed",
              retryable: true,
            },
          });
        }
        return await delegate.execute(request, execOptions);
      } finally {
        admission.release();
      }
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      admission.dispose();
      await startPromise?.catch(() => undefined);
      await removeContainer(dockerBin, options.containerName);
      await rm(workspaceRoot, { force: true, recursive: true });
    },
  };
}

function admissionFailure(
  request: SandboxRequest,
  options: SandboxExecuteOptions,
  reason: "cancelled" | "full",
): SandboxResult {
  return buildSyntheticResult({
    executionId: options.executionId,
    identity: options.identity,
    resourceProfile: request.resourceProfile ?? "sandbox-small",
    backend: "docker",
    startedAt: new Date(),
    error: new Error(
      reason === "cancelled" ? "Sandbox execution was cancelled." : "Sandbox queue is full.",
    ),
    classification:
      reason === "cancelled"
        ? { status: "cancelled", failureClass: undefined, retryable: false }
        : { status: "internal_error", failureClass: "resource_exhausted", retryable: true },
  });
}

export function createAdmissionController(
  maxConcurrency: number,
  queueCapacity: number,
): Admission {
  let active = 0;
  let disposed = false;
  const queue: Array<{
    resolve(value: "acquired" | "cancelled"): void;
    signal?: AbortSignal;
    abort?: () => void;
  }> = [];

  const remove = (entry: (typeof queue)[number]): boolean => {
    const index = queue.indexOf(entry);
    if (index < 0) return false;
    queue.splice(index, 1);
    return true;
  };

  return {
    acquire(signal) {
      if (disposed || signal?.aborted) return Promise.resolve("cancelled");
      if (active < maxConcurrency) {
        active += 1;
        return Promise.resolve("acquired");
      }
      if (queue.length >= queueCapacity) return Promise.resolve("full");
      return new Promise((resolve) => {
        const entry: (typeof queue)[number] = { resolve, signal };
        entry.abort = () => {
          if (remove(entry)) resolve("cancelled");
        };
        signal?.addEventListener("abort", entry.abort, { once: true });
        queue.push(entry);
      });
    },
    release() {
      if (active === 0) return;
      while (queue.length > 0) {
        const next = queue.shift();
        if (!next) break;
        if (next.abort) next.signal?.removeEventListener("abort", next.abort);
        if (next.signal?.aborted) {
          next.resolve("cancelled");
          continue;
        }
        next.resolve("acquired");
        return;
      }
      active -= 1;
    },
    dispose() {
      disposed = true;
      for (const entry of queue.splice(0)) {
        if (entry.abort) entry.signal?.removeEventListener("abort", entry.abort);
        entry.resolve("cancelled");
      }
    },
  };
}

async function startManagedContainer(args: {
  readonly containerName: string;
  readonly cpus: string;
  readonly dockerBin: string;
  readonly image: string;
  readonly memory: string;
  readonly workspaceRoot: string;
}): Promise<void> {
  await mkdir(args.workspaceRoot, { recursive: true });
  await chmod(args.workspaceRoot, 0o777);
  const proc = Bun.spawn({
    cmd: [
      args.dockerBin,
      "run",
      "--detach",
      "--name",
      args.containerName,
      "--network",
      "none",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--read-only",
      "--tmpfs",
      "/tmp:rw,nosuid,nodev,size=64m,mode=1777",
      "--memory",
      args.memory,
      "--cpus",
      args.cpus,
      "--user",
      "65534:65534",
      "--volume",
      `${args.workspaceRoot}:${CONTAINER_WORKSPACE_PATH}:rw`,
      args.image,
      "sh",
      "-c",
      "trap 'exit 0' TERM INT; while :; do sleep 3600 & wait $!; done",
    ],
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  if (code !== 0) {
    throw new Error(stderr.trim() || `docker run exited with code ${code}`);
  }
}

async function removeContainer(dockerBin: string, containerName: string): Promise<void> {
  try {
    const proc = Bun.spawn({
      cmd: [dockerBin, "rm", "--force", containerName],
      stdout: "ignore",
      stderr: "ignore",
    });
    await proc.exited;
  } catch {
    // Best effort: Docker may be unavailable during shutdown.
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be positive.`);
  return value;
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new TypeError(`${name} must be non-negative.`);
  return value;
}
