import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import type { SessionBusyError } from "../src/server/worker/bullmq-executor.ts";
import { isSessionBusyError } from "../src/server/worker/bullmq-executor.ts";
import { startTestRedis, type TestRedis } from "./redis-harness.ts";
import {
  buildRequest,
  drainHandle,
  hangingAgent,
  startWorkerStack,
  submitTurn,
  type WorkerStack,
} from "./worker-stack.ts";

async function redisAvailable(): Promise<boolean> {
  if (process.env.DOCKER_AVAILABLE === "0" || process.env.DOCKER_AVAILABLE === "false") {
    return Boolean(process.env.REDIS_URL?.trim());
  }
  if (process.env.REDIS_URL?.trim()) return true;
  try {
    const proc = Bun.spawn({ cmd: ["docker", "info"], stdout: "ignore", stderr: "ignore" });
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}

const REDIS_AVAILABLE = await redisAvailable();
const testIf = REDIS_AVAILABLE ? it : it.skip;

let redis: TestRedis | null = null;
let stack: WorkerStack | null = null;

beforeAll(async () => {
  if (!REDIS_AVAILABLE) return;
  redis = await startTestRedis();
});

afterAll(async () => {
  await stack?.stop();
  stack = null;
  await redis?.stop();
  redis = null;
});

describe("worker round-trip (Redis + BullMQ)", () => {
  testIf("cancels a hanging turn on abort", async () => {
    stack = await startWorkerStack({ agentSource: () => hangingAgent(), concurrency: 1 });

    const controller = new AbortController();
    const handle = await stack.executor.execute(
      buildRequest({ sessionId: "cancel-test", content: "hang" }),
      controller.signal,
    );

    const drained = drainHandle(handle);
    await new Promise((resolve) => setTimeout(resolve, 200));
    controller.abort();

    const result = await drained;
    expect(result.result.outcome).toBe("cancelled");
  });

  testIf("returns 409 for a busy session", async () => {
    stack = await startWorkerStack({ agentSource: () => hangingAgent(), concurrency: 1 });

    const controller1 = new AbortController();
    const handle1 = await stack.executor.execute(
      buildRequest({ sessionId: "busy-test", content: "hang" }),
      controller1.signal,
    );

    await new Promise((resolve) => setTimeout(resolve, 200));

    const controller2 = new AbortController();
    try {
      await stack.executor.execute(
        buildRequest({ sessionId: "busy-test", content: "second" }),
        controller2.signal,
      );
      throw new Error("expected session_busy");
    } catch (error) {
      expect(isSessionBusyError(error)).toBe(true);
      const busy = error as SessionBusyError;
      expect(busy.activeRunId).toBeDefined();
    }

    controller1.abort();
    const drained = await drainHandle(handle1);
    expect(drained.result.outcome).toBe("cancelled");
  });

  testIf("runs a simple turn end-to-end", async () => {
    stack = await startWorkerStack({
      agentSource: () => ({
        async streamEvents() {
          return {
            messages: (async function* () {
              yield {
                text: (async function* () {
                  yield "hello";
                })(),
              };
            })(),
            output: Promise.resolve({ messages: [] }),
          };
        },
        async invoke() {
          return { messages: [] };
        },
      }),
      concurrency: 1,
    });

    const result = await submitTurn(
      stack.executor,
      buildRequest({ sessionId: "simple-test", content: "say hello" }),
      new AbortController().signal,
    );
    expect(result.result.outcome).not.toBe("error");
  });
});
