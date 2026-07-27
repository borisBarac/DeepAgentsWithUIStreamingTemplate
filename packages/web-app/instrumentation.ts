// Next.js instrumentation hook: registered once per server process before
// request handling begins. Telemetry is Node-only.
//
// The shutdown listeners live in a separate Node-only module that is reached
// only via dynamic `import()` after the runtime guard below. This keeps the
// `process.on(...)` references out of Turbopack's Edge-bundle static-analysis
// pass, which would otherwise emit a misleading "A Node.js API is used" /
// "Ecmascript file had an error" warning for this file on every compile.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const [{ registerTelemetry }, { registerShutdownHandlers }, { disposeSandboxBackend }] =
    await Promise.all([
      import("./src/server/telemetry/bootstrap.ts"),
      import("./src/server/telemetry/shutdown.ts"),
      import("./src/server/agent-provider.ts"),
    ]);
  registerTelemetry();
  registerShutdownHandlers(disposeSandboxBackend);
}
