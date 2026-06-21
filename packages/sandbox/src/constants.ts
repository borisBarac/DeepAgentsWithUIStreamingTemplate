import type { SandboxResourceProfile, SandboxResourceProfileConfig } from "./types.ts";

/**
 * Default Python runtime image used by the docker backend. Pinned to a slim
 * minor tag for reproducibility (spec §7.2 — pin runtime dependencies).
 */
export const DEFAULT_PYTHON_IMAGE = "python:3.12-slim";

/**
 * Path through the container filesystem where the per-execution workspace is
 * mounted. The executed code runs with this as its CWD.
 */
export const CONTAINER_WORKSPACE_PATH = "/workspace";

/**
 * Host-side filename for the submitted Python entrypoint, written into the
 * workspace root and excluded from the returned artifacts.
 */
export const ENTRYPOINT_FILENAME = "main.py";

/**
 * Default resource profile applied when {@link SandboxRequest.resourceProfile}
 * is omitted.
 */
export const DEFAULT_RESOURCE_PROFILE: SandboxResourceProfile = "sandbox-small";

/**
 * Hard ceiling on `timeoutSeconds`. Requests above this are rejected with a
 * `validation_error` even on the largest profile. Matches spec §27 (300s max).
 */
export const MAX_TIMEOUT_CEILING_SECONDS = 300;

/**
 * Named resource profiles, mapping to spec §6 (sans GPU). Values are frozen;
 * callers must not mutate. Each backend interprets cpu/memory limits in its
 * own units.
 *
 * - `sandbox-small` — pure-computation scripts, the default.
 * - `sandbox-medium` — moderate data processing.
 * - `sandbox-large` — approved heavier workloads.
 */
export const SANDBOX_PROFILES: Readonly<
  Record<SandboxResourceProfile, SandboxResourceProfileConfig>
> = Object.freeze({
  "sandbox-small": Object.freeze({
    profile: "sandbox-small",
    cpuLimit: "0.5",
    memoryLimitMb: 256,
    maxTimeoutSeconds: 60,
    maxOutputBytes: 64 * 1024,
    maxArtifactBytes: 1024 * 1024,
    maxArtifactCount: 8,
  }),
  "sandbox-medium": Object.freeze({
    profile: "sandbox-medium",
    cpuLimit: "1.0",
    memoryLimitMb: 512,
    maxTimeoutSeconds: 180,
    maxOutputBytes: 256 * 1024,
    maxArtifactBytes: 8 * 1024 * 1024,
    maxArtifactCount: 32,
  }),
  "sandbox-large": Object.freeze({
    profile: "sandbox-large",
    cpuLimit: "2.0",
    memoryLimitMb: 1024,
    maxTimeoutSeconds: 300,
    maxOutputBytes: 1024 * 1024,
    maxArtifactBytes: 32 * 1024 * 1024,
    maxArtifactCount: 64,
  }),
});
