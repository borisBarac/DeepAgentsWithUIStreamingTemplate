import { describe, expect, it } from "bun:test";

import { SANDBOX_PROFILES } from "./constants.ts";
import {
  assertValidArtifactName,
  resolveSandboxProfile,
  SandboxValidationError,
} from "./profiles.ts";

describe("resolveSandboxProfile", () => {
  it("defaults to sandbox-small when no profile is requested", () => {
    const { config, timeoutSeconds } = resolveSandboxProfile({});
    expect(config.profile).toBe("sandbox-small");
    expect(timeoutSeconds).toBe(SANDBOX_PROFILES["sandbox-small"].maxTimeoutSeconds);
  });

  it("honors an explicit profile", () => {
    const { config } = resolveSandboxProfile({ resourceProfile: "sandbox-large" });
    expect(config.profile).toBe("sandbox-large");
  });

  it("honors an explicit timeout within the profile ceiling", () => {
    const { timeoutSeconds } = resolveSandboxProfile({
      resourceProfile: "sandbox-medium",
      timeoutSeconds: 30,
    });
    expect(timeoutSeconds).toBe(30);
  });

  it("defaults timeout to the profile ceiling when omitted", () => {
    const { config, timeoutSeconds } = resolveSandboxProfile({ resourceProfile: "sandbox-medium" });
    expect(timeoutSeconds).toBe(config.maxTimeoutSeconds);
  });

  it("rejects an unknown profile", () => {
    expect(() => resolveSandboxProfile({ resourceProfile: "sandbox-huge" as never })).toThrow(
      SandboxValidationError,
    );
  });

  it("rejects a zero or negative timeout", () => {
    expect(() => resolveSandboxProfile({ timeoutSeconds: 0 })).toThrow(SandboxValidationError);
    expect(() => resolveSandboxProfile({ timeoutSeconds: -1 })).toThrow(SandboxValidationError);
  });

  it("rejects a timeout exceeding the profile ceiling", () => {
    expect(() =>
      resolveSandboxProfile({ resourceProfile: "sandbox-small", timeoutSeconds: 120 }),
    ).toThrow(SandboxValidationError);
  });

  it("rejects a timeout exceeding the hard ceiling even on the largest profile", () => {
    expect(() =>
      resolveSandboxProfile({ resourceProfile: "sandbox-large", timeoutSeconds: 600 }),
    ).toThrow(SandboxValidationError);
  });
});

describe("assertValidArtifactName", () => {
  it("accepts simple relative paths", () => {
    expect(() => assertValidArtifactName("input.txt")).not.toThrow();
    expect(() => assertValidArtifactName("data/values.csv")).not.toThrow();
    expect(() => assertValidArtifactName("a.b.c")).not.toThrow();
    expect(() => assertValidArtifactName("kebab-case_name.json")).not.toThrow();
  });

  it("rejects absolute paths", () => {
    expect(() => assertValidArtifactName("/etc/passwd")).toThrow(SandboxValidationError);
  });

  it("rejects parent traversal", () => {
    expect(() => assertValidArtifactName("../escape.txt")).toThrow(SandboxValidationError);
    expect(() => assertValidArtifactName("a/../../escape.txt")).toThrow(SandboxValidationError);
    expect(() => assertValidArtifactName("a/../b")).toThrow(SandboxValidationError);
  });

  it("rejects backslashes", () => {
    expect(() => assertValidArtifactName("windows\\path")).toThrow(SandboxValidationError);
  });

  it("rejects empty names", () => {
    expect(() => assertValidArtifactName("")).toThrow(SandboxValidationError);
  });

  it("rejects names with shell-special characters", () => {
    expect(() => assertValidArtifactName("a;rm -rf")).toThrow(SandboxValidationError);
    expect(() => assertValidArtifactName("a b")).toThrow(SandboxValidationError);
  });
});
