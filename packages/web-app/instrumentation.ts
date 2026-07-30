export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const [{ registerTelemetry }, { registerShutdownHandlers }, { disposeSandboxBackend }] =
    await Promise.all([
      import("./src/server/telemetry/bootstrap.ts"),
      import("./src/server/telemetry/shutdown.ts"),
      import("./src/server/agent-provider.ts"),
    ]);
  registerTelemetry();
  registerShutdownHandlers(async () => {
    await disposeSandboxBackend();
  });
}
