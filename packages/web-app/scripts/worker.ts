#!/usr/bin/env bun
import { disposeLinkloomConnection, disposeSandboxBackend } from "../src/server/agent-provider.ts";
import { closeRedisClients } from "../src/server/redis/client.ts";
import { registerTelemetry, shutdownTelemetry } from "../src/server/telemetry/bootstrap.ts";
import { createAgentWorker } from "../src/server/worker/agent-worker.ts";

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
