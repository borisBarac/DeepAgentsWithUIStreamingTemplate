/**
 * Backend-agnostic sandbox runtime and concrete code-execution backends.
 *
 * Agent-facing tool definitions remain in `@deep-agent-template/core`.
 */
export {
  createDockerSandboxBackend,
  createManagedDockerSandboxBackend,
  type DockerSandboxBackendOptions,
  type ManagedDockerSandboxBackend,
  type ManagedDockerSandboxBackendOptions,
} from "./backends/index.ts";
export {
  CONTAINER_WORKSPACE_PATH,
  DEFAULT_PYTHON_IMAGE,
  DEFAULT_RESOURCE_PROFILE,
  ENTRYPOINT_FILENAME,
  MAX_TIMEOUT_CEILING_SECONDS,
  SANDBOX_PROFILES,
} from "./constants.ts";
export type {
  SandboxArtifact,
  SandboxBackend,
  SandboxBackendCapabilities,
  SandboxExecuteOptions,
  SandboxExecutionId,
  SandboxExecutionIdentity,
  SandboxFailureClass,
  SandboxRequest,
  SandboxResourceProfile,
  SandboxResourceProfileConfig,
  SandboxResult,
  SandboxStatus,
} from "./types.ts";
