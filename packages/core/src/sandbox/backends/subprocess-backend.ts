import { tmpdir } from "node:os";
import { join } from "node:path";

import { ENTRYPOINT_FILENAME } from "../constants.ts";
import type {
  SandboxBackend,
  SandboxExecuteOptions,
  SandboxRequest,
  SandboxResourceProfileConfig,
} from "../types.ts";
import {
  executeWithHandling,
  runExecution,
  type SpawnResult,
  sanitizeEnvForHost,
} from "./backend-helpers.ts";

/**
 * Reference sandbox backend with **no isolation**. Runs `python3` directly via
 * `Bun.spawn` with timeout and output caps but no filesystem, network, or
 * process boundaries.
 *
 * Purpose:
 *  1. Prove the {@link SandboxBackend} contract is clean — if the tool works
 *     with this backend, any backend works.
 *  2. Provide a no-Docker path for dev / quick tests on developer machines.
 *
 * SECURITY: Do NOT use this backend with untrusted code. It is suitable only
 * for trusted developer environments. Use {@link createDockerSandboxBackend}
 * or a hosted sandbox for code that came from an LLM or end user.
 *
 * CPU and memory limits from the resource profile are NOT enforced by this
 * backend (would require cgroups / rlimits); timeout, output caps, artifact
 * caps, and workspace isolation ARE enforced.
 */
export type SubprocessSandboxBackendOptions = {
  /** Python interpreter to invoke. Defaults to `"python3"`. */
  readonly pythonBin?: string;
  /** Root under which per-execution workspaces are created. Defaults to `os.tmpdir()`. */
  readonly workDirRoot?: string;
};

const HOST_ENV_ALLOW_LIST = [
  "PATH",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
] as const;

export function createSubprocessSandboxBackend(
  options: SubprocessSandboxBackendOptions = {},
): SandboxBackend {
  const pythonBin = options.pythonBin ?? "python3";
  const workDirRoot = options.workDirRoot ?? tmpdir();
  const backendName = "subprocess";

  async function execute(request: SandboxRequest, execOptions: SandboxExecuteOptions) {
    return executeWithHandling({
      backendName,
      request,
      execOptions,
      workDirRoot,
      run: (ctx) =>
        runExecution({
          backendName,
          request,
          execOptions,
          ...ctx,
          spawn: () => spawnSubprocess(pythonBin, ctx.workDir, request, execOptions, ctx.config),
        }),
    });
  }

  return {
    name: backendName,
    capabilities: { isolation: "none", supportsArtifacts: true, supportsAbort: true },
    execute,
  };
}

function spawnSubprocess(
  pythonBin: string,
  workDir: string,
  request: SandboxRequest,
  execOptions: SandboxExecuteOptions,
  config: SandboxResourceProfileConfig,
): SpawnResult {
  const proc = Bun.spawn({
    cmd: [pythonBin, join(workDir, ENTRYPOINT_FILENAME), ...(request.argv ?? [])],
    cwd: workDir,
    stdin: request.stdin !== undefined ? "pipe" : "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...sanitizeEnvForHost(HOST_ENV_ALLOW_LIST),
      EXECUTION_ID: execOptions.executionId,
      RESOURCE_PROFILE: config.profile,
      PYTHONUNBUFFERED: "1",
      PYTHONIOENCODING: "utf-8",
    },
  });
  return {
    proc,
    kill: () => {
      try {
        proc.kill();
      } catch {
        // ignore
      }
    },
  };
}
