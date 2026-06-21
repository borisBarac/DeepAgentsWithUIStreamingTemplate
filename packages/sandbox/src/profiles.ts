import {
  DEFAULT_RESOURCE_PROFILE,
  MAX_TIMEOUT_CEILING_SECONDS,
  SANDBOX_PROFILES,
} from "./constants.ts";
import type { SandboxResourceProfile, SandboxResourceProfileConfig } from "./types.ts";

/**
 * Resolved view of a {@link SandboxRequest}'s resource constraints, after
 * defaults are applied and the timeout is clamped to the profile ceiling.
 */
export type ResolvedSandboxProfile = {
  readonly config: SandboxResourceProfileConfig;
  readonly timeoutSeconds: number;
};

/**
 * Thrown when a request is structurally invalid (unknown profile, timeout out
 * of range, malformed artifact name). Backends should catch this and surface
 * it as a `validation_error` failure class in the result envelope.
 */
export class SandboxValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxValidationError";
  }
}

/**
 * Resolve the effective resource profile and timeout for a request.
 *
 * Rules:
 * - Profile defaults to {@link DEFAULT_RESOURCE_PROFILE} when omitted.
 * - Unknown profiles throw {@link SandboxValidationError}.
 * - `timeoutSeconds` defaults to the profile's `maxTimeoutSeconds`.
 * - `timeoutSeconds` is clamped to `[1, profile.maxTimeoutSeconds]`.
 * - `timeoutSeconds` above {@link MAX_TIMEOUT_CEILING_SECONDS} throws (defense
 *   in depth — the per-profile ceiling should already prevent this).
 */
export function resolveSandboxProfile(input: {
  readonly resourceProfile?: SandboxResourceProfile;
  readonly timeoutSeconds?: number;
}): ResolvedSandboxProfile {
  const profile = input.resourceProfile ?? DEFAULT_RESOURCE_PROFILE;
  const config = SANDBOX_PROFILES[profile];
  if (!config) {
    throw new SandboxValidationError(`Unknown sandbox resource profile: "${profile}".`);
  }

  const requested = input.timeoutSeconds;
  if (requested !== undefined) {
    if (!Number.isFinite(requested) || requested <= 0) {
      throw new SandboxValidationError(
        `timeoutSeconds must be a positive finite number, got: ${requested}.`,
      );
    }
    if (requested > MAX_TIMEOUT_CEILING_SECONDS) {
      throw new SandboxValidationError(
        `timeoutSeconds ${requested}s exceeds the hard ceiling of ${MAX_TIMEOUT_CEILING_SECONDS}s.`,
      );
    }
    if (requested > config.maxTimeoutSeconds) {
      throw new SandboxValidationError(
        `timeoutSeconds ${requested}s exceeds the "${profile}" profile ceiling of ${config.maxTimeoutSeconds}s.`,
      );
    }
  }

  const timeoutSeconds = requested ?? config.maxTimeoutSeconds;
  return { config, timeoutSeconds };
}

const ARTIFACT_NAME_PATTERN = /^[A-Za-z0-9._\-/]+$/;

/**
 * Validate a relative artifact path. Rejects absolute paths, parent traversal,
 * backslashes, control characters, and empty segments — defense in depth
 * against the executed code escaping its workspace via input-artifact names.
 *
 * Note: the executed Python can still attempt path traversal inside the
 * workspace; the backend's isolation (read-only rootfs, non-root user,
 * dropped capabilities) is the real boundary, not this check.
 */
export function assertValidArtifactName(name: string): void {
  if (name.length === 0) {
    throw new SandboxValidationError("Artifact name must not be empty.");
  }
  if (name.length > 255) {
    throw new SandboxValidationError(
      `Artifact name exceeds 255 characters: "${name.slice(0, 40)}...".`,
    );
  }
  if (name.startsWith("/")) {
    throw new SandboxValidationError(
      `Artifact name must be relative, got absolute path: "${name}".`,
    );
  }
  if (name.includes("\\")) {
    throw new SandboxValidationError(`Artifact name must not contain backslashes: "${name}".`);
  }
  if (name.includes("..")) {
    throw new SandboxValidationError(`Artifact name must not contain "..": "${name}".`);
  }
  if (!ARTIFACT_NAME_PATTERN.test(name)) {
    throw new SandboxValidationError(`Artifact name has invalid characters: "${name}".`);
  }
}
