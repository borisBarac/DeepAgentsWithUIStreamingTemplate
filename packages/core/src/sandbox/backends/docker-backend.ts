import { tmpdir } from "node:os";

import {
  CONTAINER_WORKSPACE_PATH,
  DEFAULT_PYTHON_IMAGE,
  ENTRYPOINT_FILENAME,
} from "../constants.ts";
import type {
  SandboxBackend,
  SandboxExecuteOptions,
  SandboxRequest,
  SandboxResourceProfileConfig,
} from "../types.ts";
import {
  buildSyntheticResult,
  executeWithHandling,
  runExecution,
  type SpawnResult,
  type StartFailure,
  sanitizeEnvForHost,
} from "./backend-helpers.ts";

/**
 * Sandbox backend that runs Python inside an isolated Docker container.
 *
 * Isolation (spec §7):
 *  - `--network none`               — no inbound or outbound network.
 *  - `--cap-drop ALL`               — no Linux capabilities.
 *  - `--security-opt no-new-privileges`.
 *  - `--read-only` root filesystem.
 *  - `--tmpfs /tmp`                 — small writable scratch for pip cache etc.
 *  - `--user 65534:65534`           — `nobody` (non-root).
 *  - `--memory` / `--cpus`          — per-profile cgroup limits.
 *  - Ephemeral bind-mounted workspace, removed on exit.
 *
 * Dependencies are frozen to the container image (spec §8.1): no `pip install`
 * is permitted. Network is always `none` (spec §9.1).
 *
 * SECURITY: the workspace directory is `chmod 0777` so the in-container
 * `nobody` user can write artifacts to the bind mount. This is acceptable
 * because the workspace is single-user and lives under `os.tmpdir()` (already
 * world-readable on most systems). For higher-sensitivity multi-tenant
 * deployments, swap to a Docker named volume populated via `docker cp` (see
 * `sandbox/README.md`).
 */
export type DockerSandboxBackendOptions = {
  /** Python image to run. Defaults to {@link DEFAULT_PYTHON_IMAGE}. */
  readonly pythonImage?: string;
  /** Docker CLI binary. Defaults to `"docker"`. */
  readonly dockerBin?: string;
  /** Root under which per-execution workspaces are created. Defaults to `os.tmpdir()`. */
  readonly workDirRoot?: string;
};

const HOST_ENV_ALLOW_LIST = ["PATH", "HOME", "TMPDIR"] as const;

export function createDockerSandboxBackend(
  options: DockerSandboxBackendOptions = {},
): SandboxBackend {
  const pythonImage = options.pythonImage ?? DEFAULT_PYTHON_IMAGE;
  const dockerBin = options.dockerBin ?? "docker";
  const workDirRoot = options.workDirRoot ?? tmpdir();
  const backendName = "docker";

  let dockerAvailable: boolean | undefined;

  async function execute(request: SandboxRequest, execOptions: SandboxExecuteOptions) {
    return executeWithHandling({
      backendName,
      request,
      execOptions,
      workDirRoot,
      createWorkspaceOptions: { chmodForContainerUser: true },
      preWorkspaceCheck: async (config) => {
        if (dockerAvailable === undefined) {
          dockerAvailable = await checkDockerAvailable(dockerBin);
        }
        if (!dockerAvailable) {
          return buildSyntheticResult({
            executionId: execOptions.executionId,
            resourceProfile: config.profile,
            backend: backendName,
            startedAt: new Date(),
            error: new Error(
              `Docker CLI "${dockerBin}" is not available or the daemon is not running.`,
            ),
            classification: {
              status: "internal_error",
              failureClass: "job_start_failed",
              retryable: true,
            },
          });
        }
        return undefined;
      },
      run: (ctx) => {
        const containerName = `sandbox-${sanitizeContainerSuffix(execOptions.executionId)}`;
        return runExecution({
          backendName,
          request,
          execOptions,
          ...ctx,
          spawn: () =>
            spawnDocker({
              dockerBin,
              pythonImage,
              workDir: ctx.workDir,
              containerName,
              request,
              execOptions,
              config: ctx.config,
            }),
          describeStartFailure: describeDockerStartFailure,
        });
      },
      cleanup: async () => {
        const containerName = `sandbox-${sanitizeContainerSuffix(execOptions.executionId)}`;
        await killContainer(dockerBin, containerName);
      },
    });
  }

  return {
    name: backendName,
    capabilities: { isolation: "container", supportsArtifacts: true, supportsAbort: true },
    execute,
  };
}

function spawnDocker(args: {
  readonly dockerBin: string;
  readonly pythonImage: string;
  readonly workDir: string;
  readonly containerName: string;
  readonly request: SandboxRequest;
  readonly execOptions: SandboxExecuteOptions;
  readonly config: SandboxResourceProfileConfig;
}): SpawnResult {
  const { dockerBin, pythonImage, workDir, containerName, request, execOptions, config } = args;

  const cmd = [
    dockerBin,
    "run",
    "--rm",
    "--name",
    containerName,
    // `-i` attaches the container's stdin so we can pipe request.stdin through.
    ...(request.stdin !== undefined ? ["-i"] : []),
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
    `${config.memoryLimitMb}m`,
    "--cpus",
    config.cpuLimit,
    "--user",
    "65534:65534",
    "--workdir",
    CONTAINER_WORKSPACE_PATH,
    "--env",
    `EXECUTION_ID=${execOptions.executionId}`,
    "--env",
    `RESOURCE_PROFILE=${config.profile}`,
    "--env",
    "PYTHONUNBUFFERED=1",
    "--env",
    "PYTHONIOENCODING=utf-8",
    "-v",
    `${workDir}:${CONTAINER_WORKSPACE_PATH}:rw`,
    pythonImage,
    "python",
    `${CONTAINER_WORKSPACE_PATH}/${ENTRYPOINT_FILENAME}`,
    ...(request.argv ?? []),
  ];

  const proc = Bun.spawn({
    cmd,
    cwd: workDir,
    stdin: request.stdin !== undefined ? "pipe" : "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: sanitizeEnvForHost(HOST_ENV_ALLOW_LIST),
  });

  return {
    proc,
    kill: () => killContainer(dockerBin, containerName),
  };
}

/**
 * Sniff docker stderr for daemon/image errors so they classify as retryable
 * `job_start_failed` or `image_pull_failed` rather than the user's Python
 * failing. Invoked by `runExecution` after the process exits.
 */
function describeDockerStartFailure(stderr: string): StartFailure | undefined {
  const lower = stderr.toLowerCase();
  const firstLine = stderr.split("\n")[0] ?? "";
  if (
    lower.includes("unable to find image") ||
    lower.includes("manifest") ||
    lower.includes("image not known") ||
    lower.includes("imagepull")
  ) {
    return { failureClass: "image_pull_failed", message: firstLine || "image pull failed" };
  }
  if (
    lower.includes("docker daemon") ||
    lower.includes("cannot connect to the docker daemon") ||
    lower.includes("permission denied") ||
    lower.includes("conflicts")
  ) {
    return { failureClass: "job_start_failed", message: firstLine || "docker start failed" };
  }
  return undefined;
}

async function checkDockerAvailable(dockerBin: string): Promise<boolean> {
  try {
    const proc = Bun.spawn({
      cmd: [dockerBin, "info"],
      stdout: "ignore",
      stderr: "ignore",
    });
    const code = await proc.exited;
    return code === 0;
  } catch {
    return false;
  }
}

async function killContainer(dockerBin: string, containerName: string): Promise<void> {
  try {
    const proc = Bun.spawn({
      cmd: [dockerBin, "rm", "-f", containerName],
      stdout: "ignore",
      stderr: "ignore",
    });
    await proc.exited;
  } catch {
    // best-effort
  }
}

function sanitizeContainerSuffix(executionId: string): string {
  // Docker container names must match [a-zA-Z0-9][a-zA-Z0-9_.-]*. UUIDs already
  // satisfy this; we strip anything unexpected as defense in depth.
  return executionId.replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 63);
}
