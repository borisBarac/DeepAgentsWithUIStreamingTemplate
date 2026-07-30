/**
 * Backend-agnostic sandbox runtime and concrete code-execution backends.
 *
 * MCP transport definitions live in `./mcp`.
 */
export {
  createDockerSandboxBackend,
  type DockerSandboxBackendOptions,
} from "./backends/index.ts";
export {
  CONTAINER_WORKSPACE_PATH,
  DEFAULT_PYTHON_IMAGE,
  DEFAULT_RESOURCE_PROFILE,
  ENTRYPOINT_FILENAME,
  MAX_TIMEOUT_CEILING_SECONDS,
  SANDBOX_PROFILES,
} from "./constants.ts";
export {
  createSandboxMcpServer,
  type SandboxMcpHttpServerOptions,
  type SandboxMcpServerOptions,
  startSandboxHttpServer,
  startSandboxStdioServer,
} from "./mcp/index.ts";
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
