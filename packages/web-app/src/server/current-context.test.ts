import { describe, expect, it } from "bun:test";

import { createCurrentContext } from "./current-context.ts";

describe("createCurrentContext", () => {
  it("includes the request time", () => {
    const now = new Date("2026-07-20T12:34:56.000Z");

    const context = createCurrentContext(now);

    expect(context).toContain("# Current Context");
    expect(context).toContain("2026-07-20T12:34:56.000Z");
    expect(context).toContain("transient request context");
  });
});
