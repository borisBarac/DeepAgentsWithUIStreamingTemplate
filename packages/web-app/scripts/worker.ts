#!/usr/bin/env bun
import { disposeLinkloomConnection, disposeSandboxBackend } from "../src/server/agent-provider.ts";
import { closeRedisClients } from "../src/server/redis/client.ts";
import { registerTelemetry, shutdownTelemetry } from "../src/server/telemetry/bootstrap.ts";
import { createAgentWorker } from "../src/server/worker/agent-worker.ts";

// Worker process entry point. Boots BullMQ Worker that consumes agent-turn
// jobs, runs each turn through the shared TurnRunner, and persists events +
// state to Redis. Designed to be run as its own process/container, scaled
// horizontally (more workers = more concurrency).
//
// Configuration via env:
//   REDIS_URL              — required, shared with the API
//   REDIS_KEY_PREFIX       — optional, default "dat:"
//   WEB_APP_SANDBOX_CPUS   — per-worker sandbox CPU budget
//   WEB_APP_SANDBOX_MEMORY — per-worker sandbox memory budget
//   WORKER_CONCURRENCY     — BullMQ Worker concurrency (default 5)
//   WORKER_MAX_QUEUE_WAIT_MS — maximum queue wait before failing a job (default 60000)
//   OTEL_SERVICE_NAME      — telemetry service name override

registerTelemetry();

const concurrency = (() => {
  const raw = process.env.WORKER_CONCURRENCY;
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
})();

const maxQueueWaitMs = (() => {
  const raw = process.env.WORKER_MAX_QUEUE_WAIT_MS;
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
})();

let shuttingDown = false;

async function shutdown(services: { close: () => Promise<void> } | null, code: number) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info("[worker] shutdown signal received");
  try {
    if (services) await services.close();
    await disposeSandboxBackend();
    await disposeLinkloomConnection();
    await closeRedisClients();
    await shutdownTelemetry();
  } catch (error) {
    console.error("[worker] error during shutdown", error);
  } finally {
    process.exit(code);
  }
}

const services = await createAgentWorker({ concurrency, maxQueueWaitMs });
services.worker.on("error", (error: Error) => {
  console.error("[worker] bullmq worker error", error);
});
services.worker.run();

console.info(`[worker] consuming agent-turn jobs (concurrency=${concurrency ?? "default"})`);

process.on("SIGINT", () => void shutdown(services, 0));
process.on("SIGTERM", () => void shutdown(services, 0));
process.on("uncaughtException", (error) => {
  console.error("[worker] uncaught exception", error);
  void shutdown(services, 1);
});
process.on("unhandledRejection", (reason) => {
  console.error("[worker] unhandled rejection", reason);
});
