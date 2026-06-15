import { describe, expect, it } from "bun:test";

import { createBasicAgent } from "./agent";

describe("createBasicAgent", () => {
  it("returns a scaffolded deep agent instance", () => {
    const agent = createBasicAgent({
      openRouter: {
        apiKey: "test-key",
      },
    });

    expect(typeof agent.invoke).toBe("function");
  });

  it("loads the scaffold memory files by default", () => {
    const agent = createBasicAgent({
      openRouter: {
        apiKey: "test-key",
      },
    });

    expect(agent.options.middleware?.map((middleware) => middleware.name)).toContain(
      "MemoryMiddleware",
    );
  });
});
