import { afterEach, describe, expect, it } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createAdmissionController,
  createManagedDockerSandboxBackend,
} from "./managed-docker-backend.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("managed Docker lifecycle", () => {
  it("starts one container for repeated and concurrent executions, then disposes it", async () => {
    const fixture = await fakeDocker();
    const workspaceRoot = join(fixture.root, "workspace");
    const backend = createManagedDockerSandboxBackend({
      containerName: "managed-test",
      dockerBin: fixture.bin,
      workspaceRoot,
    });

    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        backend.execute({ code: "print('ok')" }, { executionId: `exec-${index}` }),
      ),
    );
    await backend.execute({ code: "print('again')" }, { executionId: "exec-again" });

    expect(await fixture.count("run")).toBe(1);
    expect(await fixture.count("exec")).toBe(9);
    await backend.dispose();
    expect(await fixture.count("rm")).toBe(1);
    expect(await Bun.file(workspaceRoot).exists()).toBe(false);
  });

  it("returns job_start_failed and retries startup later", async () => {
    const fixture = await fakeDocker(true);
    const backend = createManagedDockerSandboxBackend({
      containerName: "managed-retry",
      dockerBin: fixture.bin,
      workspaceRoot: join(fixture.root, "workspace"),
    });

    const failed = await backend.execute({ code: "pass" }, { executionId: "first" });
    const retried = await backend.execute({ code: "pass" }, { executionId: "second" });

    expect(failed.failureClass).toBe("job_start_failed");
    expect(failed.retryable).toBe(true);
    expect(retried.status).toBe("succeeded");
    expect(await fixture.count("run")).toBe(2);
    await backend.dispose();
  });

  it("returns retryable resource_exhausted when its queue is full", async () => {
    const fixture = await fakeDocker(false, 0.15);
    const backend = createManagedDockerSandboxBackend({
      containerName: "managed-full",
      dockerBin: fixture.bin,
      workspaceRoot: join(fixture.root, "workspace"),
      maxConcurrency: 1,
      queueCapacity: 1,
    });
    const active = backend.execute({ code: "pass" }, { executionId: "active" });
    const waiting = backend.execute({ code: "pass" }, { executionId: "waiting" });
    const full = await backend.execute({ code: "pass" }, { executionId: "full" });

    expect(full.failureClass).toBe("resource_exhausted");
    expect(full.retryable).toBe(true);
    await Promise.all([active, waiting]);
    await backend.dispose();
  });

  it("returns cancelled when an aborted request leaves the queue", async () => {
    const fixture = await fakeDocker(false, 0.15);
    const backend = createManagedDockerSandboxBackend({
      containerName: "managed-cancel",
      dockerBin: fixture.bin,
      workspaceRoot: join(fixture.root, "workspace"),
      maxConcurrency: 1,
      queueCapacity: 1,
    });
    const active = backend.execute({ code: "pass" }, { executionId: "active" });
    const controller = new AbortController();
    const waiting = backend.execute(
      { code: "pass" },
      { executionId: "waiting", signal: controller.signal },
    );
    controller.abort();

    expect((await waiting).status).toBe("cancelled");
    await active;
    await backend.dispose();
  });
});

describe("managed Docker FIFO admission", () => {
  it("caps active work and admits queued work in FIFO order", async () => {
    const admission = createAdmissionController(5, 25);
    for (let index = 0; index < 5; index += 1) {
      expect(await admission.acquire()).toBe("acquired");
    }

    const order: number[] = [];
    const queued = Array.from({ length: 3 }, (_, index) =>
      admission.acquire().then((result) => {
        if (result === "acquired") order.push(index);
        return result;
      }),
    );
    admission.release();
    await queued[0];
    admission.release();
    await queued[1];
    admission.release();
    await queued[2];
    expect(order).toEqual([0, 1, 2]);
  });

  it("rejects the twenty sixth waiter as retryable resource exhaustion", async () => {
    const admission = createAdmissionController(5, 25);
    await Promise.all(Array.from({ length: 5 }, () => admission.acquire()));
    const waiting = Array.from({ length: 25 }, () => admission.acquire());
    expect(await admission.acquire()).toBe("full");
    admission.dispose();
    expect((await Promise.all(waiting)).every((value) => value === "cancelled")).toBe(true);
  });

  it("removes an aborted waiter without consuming a slot", async () => {
    const admission = createAdmissionController(1, 2);
    expect(await admission.acquire()).toBe("acquired");
    const controller = new AbortController();
    const cancelled = admission.acquire(controller.signal);
    const next = admission.acquire();
    controller.abort();
    expect(await cancelled).toBe("cancelled");
    admission.release();
    expect(await next).toBe("acquired");
  });

  it("releases capacity after each terminal path", async () => {
    const admission = createAdmissionController(1, 1);
    for (const terminal of ["success", "failure", "timeout", "cancellation"]) {
      expect(await admission.acquire()).toBe("acquired");
      admission.release();
      expect(terminal).toBeString();
    }
  });
});

async function fakeDocker(
  failFirstRun = false,
  execDelaySeconds = 0,
): Promise<{
  root: string;
  bin: string;
  count(command: string): Promise<number>;
}> {
  const root = await mkdtemp(join(tmpdir(), "managed-docker-test-"));
  roots.push(root);
  const log = join(root, "commands.log");
  const fail = join(root, "fail-first-run");
  const running = join(root, "running");
  const bin = join(root, "docker");
  if (failFirstRun) await writeFile(fail, "");
  await writeFile(
    bin,
    `#!/bin/sh
command="$1"
echo "$command" >> "${log}"
case "$command" in
  run)
    if [ -f "${fail}" ]; then rm "${fail}"; echo "start failed" >&2; exit 1; fi
    touch "${running}"
    ;;
  info) exit 0 ;;
  inspect)
    if [ -f "${running}" ]; then echo true; else echo false; exit 1; fi
    ;;
  exec) sleep ${execDelaySeconds}; exit 0 ;;
  rm) rm -f "${running}" ;;
esac
exit 0
`,
  );
  await chmod(bin, 0o755);
  return {
    root,
    bin,
    async count(command) {
      const contents = await readFile(log, "utf8").catch(() => "");
      return contents.split("\n").filter((line) => line === command).length;
    },
  };
}
