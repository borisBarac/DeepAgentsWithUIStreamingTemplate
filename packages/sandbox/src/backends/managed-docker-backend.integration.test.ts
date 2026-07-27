import { describe, expect, it } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createManagedDockerSandboxBackend } from "./managed-docker-backend.ts";

const DOCKER_AVAILABLE = await checkDockerAvailable();
const TEST_IMAGE = process.env.SANDBOX_TEST_PYTHON_IMAGE ?? "python:3.12-slim";

describe("managed Docker live concurrency", () => {
  it.skipIf(!DOCKER_AVAILABLE)(
    "runs commands for multiple users concurrently inside one managed container",
    async () => {
      const testId = crypto.randomUUID();
      const backend = createManagedDockerSandboxBackend({
        containerName: `managed-sandbox-live-${testId}`,
        workspaceRoot: await mkdtemp(join(tmpdir(), "managed-sandbox-live-")),
        image: TEST_IMAGE,
        maxConcurrency: 5,
        queueCapacity: 25,
      });
      const users = Array.from({ length: 10 }, (_, index) => ({
        identity: { tenantId: "live-test", userId: `user-${index}` },
        marker: `USER_${index}`,
      }));

      try {
        const results = await Promise.all(
          users.map(({ identity, marker }) =>
            backend.execute(
              { code: concurrentProbe(marker, testId), timeoutSeconds: 30 },
              { executionId: `live-${testId}-${identity.userId}`, identity },
            ),
          ),
        );

        const hostnames = new Set<string>();
        let maximumOverlap = 0;
        for (const [index, result] of results.entries()) {
          expect(result.status).toBe("succeeded");
          expect(result.identity).toEqual(users[index]?.identity);
          const [marker, hostname, overlapText] = result.stdout.trim().split("|");
          expect(marker).toBe(users[index]?.marker);
          expect(hostname).toBeTruthy();
          hostnames.add(hostname ?? "");
          maximumOverlap = Math.max(maximumOverlap, Number(overlapText));
        }

        expect(hostnames.size).toBe(1);
        expect(maximumOverlap).toBeGreaterThan(1);
        expect(maximumOverlap).toBeLessThanOrEqual(5);
      } finally {
        await backend.dispose();
      }
    },
    120_000,
  );
});

function concurrentProbe(marker: string, testId: string): string {
  return `
import fcntl
import json
import os
import socket
import time

state_path = "/tmp/${testId}.json"
lock_path = "/tmp/${testId}.lock"

def update(delta):
    with open(lock_path, "a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            try:
                with open(state_path) as state_file:
                    state = json.load(state_file)
            except (FileNotFoundError, json.JSONDecodeError):
                state = {"active": 0, "maximum": 0}
            state["active"] += delta
            state["maximum"] = max(state["maximum"], state["active"])
            with open(state_path, "w") as state_file:
                json.dump(state, state_file)
            return state["maximum"]
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)

update(1)
time.sleep(0.75)
maximum = update(-1)
print("${marker}|" + socket.gethostname() + "|" + str(maximum))
`;
}

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
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}
