// Node.js process-lifecycle hooks for telemetry.
//
// This module is intentionally separate from bootstrap.ts so the Edge-Runtime
// bundler never has to parse `process.on(...)` references: instrumentation.ts
// reaches it only via dynamic `import()` after the `NEXT_RUNTIME !== "nodejs"`
// guard, so Edge bundles omit it entirely and Turbopack stops emitting
// `A Node.js API is used (process.on …)` / `Ecmascript file had an error`.
//
// Idempotent: registering twice replaces the previous listeners, so hot
// reloads in dev do not accumulate handlers.

import { shutdownTelemetry } from "./bootstrap.ts";

const SIGNALS = ["SIGTERM", "SIGINT"] as const;

let registeredSignals: readonly string[] = [];

export function registerShutdownHandlers(onShutdown?: () => Promise<void>): void {
  unregisterShutdownHandlers();
  const handler = (): void => {
    void Promise.allSettled([shutdownTelemetry(), onShutdown?.()]);
  };
  for (const signal of SIGNALS) {
    process.on(signal, handler);
  }
  registeredSignals = SIGNALS;
}

export function unregisterShutdownHandlers(): void {
  for (const signal of registeredSignals) {
    process.removeAllListeners(signal);
  }
  registeredSignals = [];
}
