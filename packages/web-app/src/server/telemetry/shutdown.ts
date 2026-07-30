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
