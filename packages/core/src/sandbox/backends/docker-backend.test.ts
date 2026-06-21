import { describe, expect, it } from "bun:test";

import { describeSandboxBackend } from "../backend-test-harness.ts";
import { createDockerSandboxBackend } from "./docker-backend.ts";

const DOCKER_AVAILABLE = await checkDockerAvailable();
const TEST_PYTHON_IMAGE = process.env.SANDBOX_TEST_PYTHON_IMAGE ?? "python:3.12-alpine";

describeSandboxBackend(
  "docker",
  () => createDockerSandboxBackend({ pythonImage: TEST_PYTHON_IMAGE }),
  {
    skipIf: () => !DOCKER_AVAILABLE,
    timeoutMs: 60_000,
  },
);

async function checkDockerAvailable(): Promise<boolean> {
  if (process.env.DOCKER_AVAILABLE === "0" || process.env.DOCKER_AVAILABLE === "false") {
    return false;
  }
  try {
    const proc = Bun.spawn({
      cmd: ["docker", "info"],
      stdout: "ignore",
      stderr: "ignore",
    });
    const code = await proc.exited;
    return code === 0;
  } catch {
    return false;
  }
}

describe("docker availability flag", () => {
  it.skipIf(!DOCKER_AVAILABLE)("is reported honestly by the suite", () => {
    expect(DOCKER_AVAILABLE).toBe(true);
  });
});
