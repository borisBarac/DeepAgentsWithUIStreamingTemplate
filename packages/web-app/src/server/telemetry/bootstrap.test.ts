import { describe, expect, it } from "bun:test";

import { shutdownTelemetry } from "./bootstrap.ts";

describe("registerTelemetry", () => {
  it("registers at most once per process", async () => {
    const { isTelemetryRegistered, registerTelemetry } = await import("./bootstrap.ts");
    registerTelemetry();
    registerTelemetry();
    expect(isTelemetryRegistered()).toBe(true);
    await shutdownTelemetry();
  });
});
