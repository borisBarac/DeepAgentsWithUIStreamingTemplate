import { describe, expect, it } from "bun:test";

import * as index from "./index.ts";

describe("sandbox package exports", () => {
  it("exposes the runtime contract, profiles, backend, and acceptance harness", () => {
    expect(index.DEFAULT_RESOURCE_PROFILE).toBe("sandbox-small");
    expect(index.SANDBOX_PROFILES["sandbox-large"].memoryLimitMb).toBe(1024);
    expect(typeof index.createDockerSandboxBackend).toBe("function");
  });
});
