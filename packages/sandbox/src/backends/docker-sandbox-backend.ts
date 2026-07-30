import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

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
  DOCKER_ISOLATION_FLAGS,
  dockerRm,
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
  /**
   * When set, reuse a long-lived container (e.g. one started by
   * `docker compose up`) instead of running `docker run` per execution.
   *
   * The container MUST already be running and MUST bind-mount `workDirRoot`
   * to {@link CONTAINER_WORKSPACE_PATH} (`/workspace`) so per-execution
   * workspaces are visible inside the container. It should also apply the
   * same isolation flags the `docker run` path applies (network none,
   * cap-drop ALL, read-only rootfs, user 65534:65534, …) — the project's
   * `infra/docker-compose.yml` is the reference configuration.
   *
   * When `containerName` is set, `workDirRoot` is REQUIRED and MUST match
   * the host path bind-mounted to `/workspace` in the named container.
   *
   * Tradeoffs vs. the default per-execution `docker run` path:
   *  - PRO: Faster startup — no container creation per execution.
   *  - CON: CPU/memory limits from the resource profile are NOT enforced
   *    per-execution; the container's overall limits apply. Despite this,
   *    the {@link SandboxResult}'s `resourceProfile` field still reports
   *    the requested profile, so consumers must not treat it as evidence
   *    of enforcement in this mode.
   *  - CON: `/tmp` is NOT isolated per-execution — the container's single
   *    tmpfs is shared across all executions for the container's lifetime.
   *    Code using `tempfile.NamedTemporaryFile` can leak between sequential
   *    executions. Only the per-execution workspace subdir is isolated.
   *  - CON: Container lifecycle must be managed externally (compose,
   *    systemd, …).
   *  - CON: NOT safe for concurrent executions. All processes share the
   *    container's `nobody` (65534:65534) uid, and Linux permits same-uid
   *    signal delivery without `CAP_KILL` — so `cap_drop: ALL` does not
   *    stop one execution from `os.kill`-ing another. The `docker run`
   *    path gives each execution its own PID namespace and is the right
   *    choice if you need concurrency or defense against hostile code.
   *
   * Per-execution filesystem isolation of the workspace IS preserved: each
   * execution still gets its own `sandbox-XXXX` subdirectory under the bind
   * mount, and abort/timeout forwards a SIGKILL to the in-container Python
   * via a `/proc` scan.
   */
  readonly containerName?: string;
};

const HOST_ENV_ALLOW_LIST = ["PATH", "HOME", "TMPDIR"] as const;

export function createDockerSandboxBackend(
  options: DockerSandboxBackendOptions = {},
): SandboxBackend {
  const pythonImage = options.pythonImage ?? DEFAULT_PYTHON_IMAGE;
  const dockerBin = options.dockerBin ?? "docker";
  const workDirRoot = options.workDirRoot ?? tmpdir();
  const containerName = options.containerName;
  const reuseContainer = containerName !== undefined;
  const backendName = "docker";

  if (reuseContainer && options.workDirRoot === undefined) {
    throw new TypeError(
      "createDockerSandboxBackend: workDirRoot is REQUIRED when containerName is set. " +
        "It must be the host path bind-mounted to /workspace in the named container.",
    );
  }

  let dockerAvailable: boolean | undefined;
  // NOTE: `containerRunning` is intentionally NOT cached across executions.
  // The container can be stopped at any time (`docker compose down`, crash,
  // host restart) and a stale `true` would route the failure through
  // describeDockerStartFailure (which doesn't recognise "No such container"
  // or "is not running" stderr), misclassifying it as nonzero_exit instead
  // of the job_start_failed envelope we want. `docker inspect` is cheap.
  let containerRunning: boolean | undefined;

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
            identity: execOptions.identity,
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
        if (reuseContainer) {
          // Re-check on every call — see the comment on `containerRunning`
          // above for why we don't cache a positive result.
          containerRunning = await checkContainerRunning(dockerBin, containerName);
          if (!containerRunning) {
            return buildSyntheticResult({
              executionId: execOptions.executionId,
              identity: execOptions.identity,
              resourceProfile: config.profile,
              backend: backendName,
              startedAt: new Date(),
              error: new Error(
                `Container "${containerName}" is not running. ` +
                  `Start it first, e.g. \`docker compose up --detach sandbox\`.`,
              ),
              classification: {
                status: "internal_error",
                failureClass: "job_start_failed",
                retryable: true,
              },
            });
          }
        }
        return undefined;
      },
      run: (ctx) => {
        return runExecution({
          backendName,
          request,
          execOptions,
          ...ctx,
          spawn: () =>
            reuseContainer
              ? spawnDockerExec({
                  dockerBin,
                  hostWorkspaceRoot: workDirRoot,
                  containerWorkspaceRoot: CONTAINER_WORKSPACE_PATH,
                  workDir: ctx.workDir,
                  containerName,
                  request,
                  execOptions,
                  config: ctx.config,
                })
              : spawnDocker({
                  dockerBin,
                  pythonImage,
                  workDir: ctx.workDir,
                  containerName: `sandbox-${sanitizeContainerSuffix(execOptions.executionId)}`,
                  request,
                  execOptions,
                  config: ctx.config,
                }),
          describeStartFailure: describeDockerStartFailure,
        });
      },
      // Only kill the container in `docker run` mode — the long-lived
      // container in `docker exec` mode is managed externally.
      cleanup: reuseContainer
        ? undefined
        : async () => {
            await dockerRm(
              dockerBin,
              `sandbox-${sanitizeContainerSuffix(execOptions.executionId)}`,
            );
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
    ...DOCKER_ISOLATION_FLAGS,
    "--memory",
    `${config.memoryLimitMb}m`,
    "--cpus",
    config.cpuLimit,
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
    kill: () => dockerRm(dockerBin, containerName),
  };
}

/**
 * {@link spawnDocker}'s counterpart for the `containerName` mode: run Python
 * inside an already-running container via `docker exec`.
 *
 * The container's isolation flags (network none, cap-drop, read-only rootfs,
 * non-root user, …) are baked in at `docker compose up` time — `docker exec`
 * inherits them. Per-execution isolation comes from each execution getting
 * its own subdirectory under the bind-mounted workspace.
 *
 * The host-side per-execution workspace (`workDir`) lives under
 * `hostWorkspaceRoot`, which the container bind-mounts at
 * `containerWorkspaceRoot`. We translate the relative subpath so the
 * container sees the same files.
 *
 * CPU/memory limits from the profile are NOT applied — `docker exec` cannot
 * set cgroup limits per-execution. The container's overall limits apply.
 */
function spawnDockerExec(args: {
  readonly dockerBin: string;
  readonly hostWorkspaceRoot: string;
  readonly containerWorkspaceRoot: string;
  readonly workDir: string;
  readonly containerName: string;
  readonly request: SandboxRequest;
  readonly execOptions: SandboxExecuteOptions;
  readonly config: SandboxResourceProfileConfig;
}): SpawnResult {
  const {
    dockerBin,
    hostWorkspaceRoot,
    containerWorkspaceRoot,
    workDir,
    containerName,
    request,
    execOptions,
    config,
  } = args;

  // Resolve to absolute paths before computing the relative segment, so a
  // relative `hostWorkspaceRoot` (e.g. "./sandbox-workspace") works.
  const rel = relative(resolve(hostWorkspaceRoot), resolve(workDir));
  const containerWorkDir = join(containerWorkspaceRoot, rel);
  const containerEntrypoint = join(containerWorkDir, ENTRYPOINT_FILENAME);

  const cmd = [
    dockerBin,
    "exec",
    // `-i` attaches exec's stdin so we can pipe request.stdin through.
    ...(request.stdin !== undefined ? ["-i"] : []),
    "--workdir",
    containerWorkDir,
    "--env",
    `EXECUTION_ID=${execOptions.executionId}`,
    "--env",
    `RESOURCE_PROFILE=${config.profile}`,
    "--env",
    "PYTHONUNBUFFERED=1",
    "--env",
    "PYTHONIOENCODING=utf-8",
    containerName,
    "python",
    containerEntrypoint,
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
    // `docker exec`'s host-side client and the in-container Python are separate
    // processes. Killing the Bun proc only kills the client; the Python keeps
    // running (burning the shared container's CPU/memory) until we explicitly
    // signal it. python:3.12-slim doesn't ship pkill, so we scan /proc for the
    // unique entrypoint path in each process's cmdline and SIGKILL the match.
    // SIGKILL matches the `docker rm -f` semantics used by spawnDocker's kill.
    kill: () => {
      try {
        proc.kill();
      } catch {
        // best-effort
      }
      void killInContainerProcess(dockerBin, containerName, containerEntrypoint);
    },
  };
}

/**
 * Best-effort SIGKILL of any process inside the container whose cmdline
 * contains `entrypointPath`. Used by `docker exec` mode's kill handle, since
 * killing the host-side `docker exec` client alone leaves the in-container
 * Python running. Each execution has a unique entrypoint path (it lives under
 * a per-execution mkdtemp dir), so the match is unambiguous.
 */
async function killInContainerProcess(
  dockerBin: string,
  containerName: string,
  entrypointPath: string,
): Promise<void> {
  // grep -F (fixed-string) so the entrypoint's slashes and dots aren't
  // interpreted as regex. -q (quiet), -a (treat binary cmdline as text).
  const script = `for p in /proc/[0-9]*; do
    if grep -qaF "${entrypointPath}" "$p/cmdline" 2>/dev/null; then
      kill -KILL "$(basename "$p")" 2>/dev/null || true;
    fi;
  done`;
  try {
    const proc = Bun.spawn({
      cmd: [dockerBin, "exec", containerName, "sh", "-c", script],
      stdout: "ignore",
      stderr: "ignore",
    });
    await proc.exited;
  } catch {
    // best-effort — container may be gone, shell may have failed, etc.
  }
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

/**
 * Whether the named container exists and is in the "running" state. Used by
 * the `containerName` mode to short-circuit with a clear `job_start_failed`
 * envelope instead of letting `docker exec` fail with a noisier error.
 */
async function checkContainerRunning(dockerBin: string, containerName: string): Promise<boolean> {
  try {
    const proc = Bun.spawn({
      cmd: [dockerBin, "inspect", "--format", "{{.State.Running}}", containerName],
      stdout: "pipe",
      stderr: "ignore",
    });
    const code = await proc.exited;
    if (code !== 0) {
      return false;
    }
    const output = await new Response(proc.stdout).text();
    return output.trim() === "true";
  } catch {
    return false;
  }
}

function sanitizeContainerSuffix(executionId: string): string {
  // Docker container names must match [a-zA-Z0-9][a-zA-Z0-9_.-]*. UUIDs already
  // satisfy this; we strip anything unexpected as defense in depth.
  return executionId.replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 63);
}
