import { describe, expect, it } from "bun:test";

import { describeSandboxBackend } from "../backend-test-harness.ts";
import { createDockerSandboxBackend } from "./docker-backend.ts";

const DOCKER_AVAILABLE = await checkDockerAvailable();
const TEST_PYTHON_IMAGE = process.env.SANDBOX_TEST_PYTHON_IMAGE ?? "python:3.12-alpine";

// Compose-mode integration test is opt-in. Set SANDBOX_TEST_COMPOSE_CONTAINER
// to the name of a container started by `docker compose up` (e.g. the
// `python-sandbox` service in the project's docker-compose.yml).
const COMPOSE_CONTAINER = process.env.SANDBOX_TEST_COMPOSE_CONTAINER ?? "";
const COMPOSE_WORKDIR_ROOT = process.env.SANDBOX_TEST_COMPOSE_WORKDIR_ROOT ?? "";
const COMPOSE_READY =
  COMPOSE_CONTAINER !== "" &&
  COMPOSE_WORKDIR_ROOT !== "" &&
  (await checkContainerRunning(COMPOSE_CONTAINER));

describeSandboxBackend(
  "docker",
  () => createDockerSandboxBackend({ pythonImage: TEST_PYTHON_IMAGE }),
  {
    skipIf: () => !DOCKER_AVAILABLE,
    timeoutMs: 60_000,
  },
);

describeSandboxBackend(
  "docker:compose",
  () =>
    createDockerSandboxBackend({
      containerName: COMPOSE_CONTAINER,
      workDirRoot: COMPOSE_WORKDIR_ROOT,
    }),
  {
    skipIf: () => !COMPOSE_READY,
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

async function checkContainerRunning(containerName: string): Promise<boolean> {
  if (!DOCKER_AVAILABLE) {
    return false;
  }
  try {
    const proc = Bun.spawn({
      cmd: ["docker", "inspect", "--format", "{{.State.Running}}", containerName],
      stdout: "pipe",
      stderr: "ignore",
    });
    const code = await proc.exited;
    if (code !== 0) {
      return false;
    }
    const output = await new Response(proc.stdout).text();
    return output.trim() === "true";
  } catch {
    return false;
  }
}

describe("docker availability flag", () => {
  it.skipIf(!DOCKER_AVAILABLE)("is reported honestly by the suite", () => {
    expect(DOCKER_AVAILABLE).toBe(true);
  });
});

describe("createDockerSandboxBackend: containerName option", () => {
  it("throws when containerName is set without workDirRoot", () => {
    expect(() => createDockerSandboxBackend({ containerName: "python-sandbox" })).toThrowError(
      /workDirRoot is REQUIRED/,
    );
  });

  it("accepts containerName together with workDirRoot", () => {
    const backend = createDockerSandboxBackend({
      containerName: "python-sandbox",
      workDirRoot: "/tmp/sandbox-workspace",
    });
    expect(backend.name).toBe("docker");
    expect(backend.capabilities.isolation).toBe("container");
  });
});
