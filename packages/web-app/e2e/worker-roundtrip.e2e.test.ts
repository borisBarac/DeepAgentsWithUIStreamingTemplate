import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import type { ComponentInstance, ModelUiOutput } from "@deep-agent-template/core/generative-ui";
import { hasLiveLLMCredentials } from "../../core/e2e/json-helpers.ts";
import { extractUiUpdates, validatePresentationOutput } from "../../core/e2e/validation-helpers.ts";
import type { SessionBusyError } from "../src/server/worker/bullmq-executor.ts";
import { isSessionBusyError } from "../src/server/worker/bullmq-executor.ts";
import {
  buildProductAgentSource,
  PRODUCT_DESCRIPTIONS,
  PRODUCT_REQUEST,
  PRODUCT_TITLES,
} from "./product-scenario.ts";
import { startTestRedis, type TestRedis } from "./redis-harness.ts";
import {
  buildRequest,
  drainHandle,
  hangingAgent,
  startWorkerStack,
  submitTurn,
  type WorkerStack,
} from "./worker-stack.ts";

// Redis is the only hard dependency for the worker-machinery tests. Docker (for
// the testcontainer) OR an externally-provided REDIS_URL satisfies it. Probed at
// module load so describes can skip cleanly when neither is available.
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
const hasRedis = REDIS_AVAILABLE;
// Happy path additionally needs live LLM credentials (RUN_LIVE_E2E=1 + keys).
const hasProductWorkflow = REDIS_AVAILABLE && hasLiveLLMCredentials;

// Shared testcontainer Redis for the whole file. The two describes below each
// spin their own in-process worker stack against it; sessions/runIds are
// unique per test so they never collide on the same keyspace.
let redis: TestRedis | null = null;

beforeAll(async () => {
  if (!REDIS_AVAILABLE) return;
  redis = await startTestRedis();
});

afterAll(async () => {
  await redis?.stop();
  redis = null;
});

// ---------------------------------------------------------------------------
// Worker machinery — no LLM required. A hanging agent exercises the real
// BullMQ queue + Redis stream + cancellation poller + session lock.
// ---------------------------------------------------------------------------

describe.skipIf(!hasRedis)("worker round-trip (no LLM)", () => {
  let stack: WorkerStack;

  beforeAll(async () => {
    stack = await startWorkerStack({ agentSource: () => hangingAgent() });
  });

  afterAll(async () => {
    await stack?.stop();
  });

  it("aborts an in-flight turn and resolves cancelled", async () => {
    const sessionId = `cancel-${crypto.randomUUID()}`;
    const request = buildRequest({ sessionId, content: "hang" });
    const controller = new AbortController();

    // Submit without awaiting: the turn runs in the worker and hangs.
    const turn = submitTurn(stack.executor, request, controller.signal);

    // Give the worker time to pick up the job and start the hanging turn so
    // the cancellation flag is observed against an in-flight interaction.
    await new Promise((resolve) => setTimeout(resolve, 750));

    controller.abort();
    const { result, events } = await turn;

    expect(result.outcome).toBe("cancelled");
    // The terminal result must have been relayed back over the Redis stream.
    expect(events.some((event) => event.kind === "result")).toBe(true);
  }, 30_000);

  it("rejects a second turn on an in-flight session with session-busy", async () => {
    const sessionId = `busy-${crypto.randomUUID()}`;
    const request1 = buildRequest({ sessionId, content: "hang" });
    const request2 = buildRequest({ sessionId, content: "again" });

    const controller = new AbortController();
    // Acquire the lock + enqueue the first (hanging) turn.
    const handle1 = await stack.executor.execute(request1, controller.signal);
    const drain1 = drainHandle(handle1);

    // A second turn on the same session must fail fast with a 409-shaped
    // SessionBusyError whose activeRunId points at the in-flight run.
    let caught: unknown;
    try {
      await stack.executor.execute(request2, AbortSignal.timeout(5_000));
      throw new Error("expected the second turn to be rejected as session-busy");
    } catch (error) {
      caught = error;
    }
    expect(isSessionBusyError(caught)).toBe(true);
    expect((caught as SessionBusyError).activeRunId).toBe(request1.runId);

    // Release the in-flight turn so the worker finalizes and the stack can
    // tear down cleanly.
    controller.abort();
    await drain1;
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Full product workflow through the worker — live LLM. Validates that the
// worker relays the real multi-phase agent run and delivers deterministic
// ProductCard UI matching the supervisor's pinned batch.
// ---------------------------------------------------------------------------

describe.skipIf(!hasProductWorkflow)("worker round-trip: product workflow (live LLM)", () => {
  let stack: WorkerStack;

  beforeAll(async () => {
    stack = await startWorkerStack({ agentSource: buildProductAgentSource() });
  });

  afterAll(async () => {
    await stack?.stop();
  });

  it("runs clarifier -> execution -> product-generator -> reviewer -> delivery and delivers matching ProductCards", async () => {
    const sessionId = `product-${crypto.randomUUID()}`;
    const request = buildRequest({
      sessionId,
      content: PRODUCT_REQUEST,
      includeActivity: true,
    });

    const { events, result } = await submitTurn(
      stack.executor,
      request,
      AbortSignal.timeout(180_000),
    );

    // The turn completed successfully through the worker.
    expect(result.outcome).toBe("success");

    // Lifecycle + UI events were relayed over the Redis stream (not just the
    // terminal result).
    expect(events.some((event) => event.kind === "lifecycle" && event.phase === "started")).toBe(
      true,
    );
    expect(events.some((event) => event.kind === "ui")).toBe(true);

    // The structured output carries the final product presentation.
    const validation = validatePresentationOutput(result.structuredOutput);
    if (!validation.ok || !validation.output) {
      throw new Error(
        `Product workflow did not produce valid UI:\n${validation.issues
          .map((issue) => `${issue.path} [${issue.code}]: ${issue.message}`)
          .join("\n")}`,
      );
    }
    const output = validation.output as ModelUiOutput;
    const ui = extractUiUpdates(output)[0];
    if (!ui) throw new Error("Product workflow produced no UI update.");

    // One ProductGrid rooted at "products" with exactly two ProductCards.
    expect(ui.rootId).toBe("products");
    const cards = ui.components.filter(
      (component): component is ComponentInstance => component.component === "ProductCard",
    );
    expect(cards).toHaveLength(2);

    // Titles/descriptions match the supervisor's pinned batch exactly. IDs
    // are model-generated, so they are matched indirectly via the grid's
    // children rather than asserted ahead of time.
    const grid = ui.components.find((component) => component.component === "ProductGrid");
    expect(grid?.children).toEqual(cards.map((card) => card.id));
    expect(new Set(cards.map((card) => card.title))).toEqual(new Set(PRODUCT_TITLES));
    for (const card of cards) {
      const index = PRODUCT_TITLES.indexOf(card.title as (typeof PRODUCT_TITLES)[number]);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(card.description).toBe(PRODUCT_DESCRIPTIONS[index]);
    }
  }, 180_000);
});
