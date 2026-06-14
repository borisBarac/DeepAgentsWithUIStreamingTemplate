import { describe, expect, it } from "bun:test";

import { createGreeting } from "./index";

describe("createGreeting", () => {
  it("greets the default audience", () => {
    expect(createGreeting()).toBe("Hello, world!");
  });

  it("greets a provided name", () => {
    expect(createGreeting({ name: "Bun" })).toBe("Hello, Bun!");
  });

  it("falls back when the provided name is blank", () => {
    expect(createGreeting({ name: "   " })).toBe("Hello, world!");
  });
});
