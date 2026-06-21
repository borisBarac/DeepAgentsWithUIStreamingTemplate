/**
 * Agent-facing sandbox tools.
 *
 * Code-execution contracts and backends live in
 * `@deep-agent-template/sandbox`. They are re-exported here to preserve the
 * existing `@deep-agent-template/core` API.
 */

export {
  CONTAINER_WORKSPACE_PATH,
  createDockerSandboxBackend,
  DEFAULT_PYTHON_IMAGE,
  DEFAULT_RESOURCE_PROFILE,
  type DockerSandboxBackendOptions,
  describeSandboxBackend,
  ENTRYPOINT_FILENAME,
  SANDBOX_PROFILES,
  type SandboxArtifact,
  type SandboxBackend,
  type SandboxBackendCapabilities,
  type SandboxExecuteOptions,
  type SandboxExecutionId,
  type SandboxFailureClass,
  type SandboxRequest,
  type SandboxResourceProfile,
  type SandboxResourceProfileConfig,
  type SandboxResult,
  type SandboxStatus,
} from "@deep-agent-template/sandbox";
export {
  type CreatePythonSandboxToolOptions,
  createPythonSandboxTool,
  createPythonSandboxToolDefinition,
} from "./tool.ts";
