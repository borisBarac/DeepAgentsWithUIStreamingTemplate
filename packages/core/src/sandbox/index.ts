/**
 * Sandbox module — isolated Python execution for the Deep Agent runtime.
 *
 * Architecture: the tool layer depends only on the {@link SandboxBackend}
 * interface. Concrete backends live under `./backends/` and are passed in at
 * tool-construction time. See `sandbox/README.md` for the full design,
 * security model, and the "Writing a new backend" contract.
 *
 * Public API (this barrel):
 *  - Tool factories:           createPythonSandboxTool, createPythonSandboxToolDefinition
 *  - Backend factories:        createDockerSandboxBackend, createSubprocessSandboxBackend
 *  - Test harness:             describeSandboxBackend
 *  - Core types & constants:   see exports below
 *
 * Backend authors who need lower-level helpers (runExecution, executeWithHandling,
 * resolveSandboxProfile, classifyFailure, …) can import them directly from their
 * source files under `./backends/` and `./profiles.ts` / `./envelope.ts`.
 */

export { describeSandboxBackend } from "./backend-test-harness.ts";
export {
  createDockerSandboxBackend,
  createSubprocessSandboxBackend,
  type DockerSandboxBackendOptions,
  type SubprocessSandboxBackendOptions,
} from "./backends/index.ts";
export {
  CONTAINER_WORKSPACE_PATH,
  DEFAULT_PYTHON_IMAGE,
  DEFAULT_RESOURCE_PROFILE,
  ENTRYPOINT_FILENAME,
  SANDBOX_PROFILES,
} from "./constants.ts";
export {
  type CreatePythonSandboxToolOptions,
  createPythonSandboxTool,
  createPythonSandboxToolDefinition,
} from "./tool.ts";
export type {
  SandboxArtifact,
  SandboxBackend,
  SandboxBackendCapabilities,
  SandboxExecuteOptions,
  SandboxExecutionId,
  SandboxFailureClass,
  SandboxRequest,
  SandboxResourceProfile,
  SandboxResourceProfileConfig,
  SandboxResult,
  SandboxStatus,
} from "./types.ts";
