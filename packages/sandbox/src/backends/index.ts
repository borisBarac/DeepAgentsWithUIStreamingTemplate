/**
 * Concrete {@link SandboxBackend} implementations.
 *
 * Each backend lives in its own file and is exported through this barrel. The
 * shared `describeSandboxBackend` harness proves they honor the same contract.
 *
 * To add a new backend (cloud-run, e2b, vercel-sandbox, …), implement
 * {@link SandboxBackend} and call `describeSandboxBackend(...)` from its test
 * file. See `sandbox/README.md`.
 */

export {
  createDockerSandboxBackend,
  type DockerSandboxBackendOptions,
} from "./docker-backend.ts";
export {
  createManagedDockerSandboxBackend,
  type ManagedDockerSandboxBackend,
  type ManagedDockerSandboxBackendOptions,
} from "./managed-docker-backend.ts";
