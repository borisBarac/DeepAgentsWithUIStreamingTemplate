import { describe, expect, it } from "bun:test";

import { isTelemetryRegistered, registerTelemetry } from "./bootstrap.ts";

describe("registerTelemetry", () => {
  it("registers at most once per process", () => {
    registerTelemetry();
    registerTelemetry();
    expect(isTelemetryRegistered()).toBe(true);
  });
});
