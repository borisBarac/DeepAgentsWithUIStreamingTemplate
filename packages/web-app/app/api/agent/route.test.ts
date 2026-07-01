import { afterEach, describe, expect, it } from "bun:test";

import { finalTextToMessageFallback, POST, productBatchTextToUiUpdates } from "./route.ts";

type FakeStreamRun = {
  messages: AsyncIterable<{
    text: AsyncIterable<string>;
  }>;
  subagents?: AsyncIterable<{
    name?: string;
    taskInput?: unknown;
    messages?: AsyncIterable<{
      text: AsyncIterable<string>;
    }>;
    output?: Promise<unknown>;
  }>;
  output: Promise<{ messages: Array<{ content: string; role: "assistant" }> }>;
};

type FakeAgent = {
  streamEvents: (input?: {
    messages: Array<{ content: string; role: "assistant" | "user" }>;
  }) => Promise<FakeStreamRun>;
};

type InspectableAgent = FakeAgent & {
  inputs: Array<{ messages: Array<{ content: string; role: "assistant" | "user" }> }>;
};

function asyncIterableFrom<T>(items: T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) {
        yield item;
      }
    },
  };
}

function createStreamingAgent(outputs: string[]): FakeAgent {
  let index = 0;
  return {
    async streamEvents() {
      const text = outputs[Math.min(index, outputs.length - 1)] ?? "";
      index += 1;
      return {
        messages: asyncIterableFrom([
          {
            text: asyncIterableFrom([text]),
          },
        ]),
        output: Promise.resolve({
          messages: [{ content: text, role: "assistant" }],
        }),
      };
    },
  };
}

function createInspectableAgent(
  outputs: string[],
  resultMessages?: Array<{ content: string; role: "assistant" }>,
): InspectableAgent {
  let index = 0;
  const inputs: Array<{ messages: Array<{ content: string; role: "assistant" | "user" }> }> = [];
  return {
    inputs,
    async streamEvents(input) {
      if (input) {
        inputs.push(input);
      }
      const text = outputs[Math.min(index, outputs.length - 1)] ?? "";
      index += 1;
      return {
        messages: asyncIterableFrom([
          {
            text: asyncIterableFrom([text]),
          },
        ]),
        output: Promise.resolve({
          messages: resultMessages ?? [{ content: text, role: "assistant" }],
        }),
      };
    },
  };
}

function createSubagentStreamingAgent(): FakeAgent {
  return {
    async streamEvents() {
      const text = '{"type":"message","text":"done"}\n';
      return {
        messages: asyncIterableFrom([
          {
            text: asyncIterableFrom([text]),
          },
        ]),
        subagents: asyncIterableFrom([
          {
            name: "researcher",
            taskInput: "Find supporting facts",
            messages: asyncIterableFrom([
              {
                text: asyncIterableFrom(["Searching", " sources"]),
              },
            ]),
            output: Promise.resolve({}),
          },
        ]),
        output: Promise.resolve({
          messages: [{ content: text, role: "assistant" }],
        }),
      };
    },
  };
}

async function readNdjson(response: Response): Promise<unknown[]> {
  const text = await response.text();
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown);
}

afterEach(async () => {
  const route = await import("./route.ts");
  route.setAgentForTest(null);
});

describe("productBatchTextToUiUpdates", () => {
  it("converts structured product-generator output into product-card UI updates", () => {
    const updates = productBatchTextToUiUpdates(
      JSON.stringify({
        products: [
          {
            id: "launch-map",
            title: "Launch Map",
            description: "A planning workspace for design teams.",
            imageUrl: "https://example.com/launch-map.png",
            status: "complete",
          },
          {
            id: "brief-lens",
            title: "Brief Lens",
            description: "A concept review assistant for product teams.",
          },
        ],
      }),
    );

    expect(updates).toHaveLength(2);
    expect(updates[0]).toEqual({
      type: "ui",
      spec: {
        root: "launch-map",
        elements: {
          "launch-map": {
            type: "product-card",
            props: {
              id: "launch-map",
              title: "Launch Map",
              description: "A planning workspace for design teams.",
              imageUrl: "https://example.com/launch-map.png",
              status: "complete",
            },
            children: [],
          },
        },
      },
    });
    expect(updates[1]?.type).toBe("ui");
    if (updates[1]?.type !== "ui") {
      throw new Error("expected second update to be a ui update");
    }
    expect(updates[1].spec.root).toBe("brief-lens");
  });

  it("returns updates for valid product batches so the zero-valid error is skipped", () => {
    expect(
      productBatchTextToUiUpdates(
        JSON.stringify({
          products: [{ id: "concept-1", title: "Concept", description: "Description" }],
        }),
      ).length,
    ).toBeGreaterThan(0);
  });

  it("ignores malformed text and invalid product batches", () => {
    expect(productBatchTextToUiUpdates("not json")).toEqual([]);
    expect(productBatchTextToUiUpdates(JSON.stringify({ products: [] }))).toEqual([]);
  });
});

describe("finalTextToMessageFallback", () => {
  it("uses usable final model text as a chat message", () => {
    expect(finalTextToMessageFallback("  Plain assistant text.  ")).toEqual({
      type: "message",
      text: "Plain assistant text.",
    });
  });

  it("uses a retry prompt when final model text is empty", () => {
    expect(finalTextToMessageFallback("   ")).toEqual({
      type: "message",
      text: "I could not render that as an interactive UI, but I can try again with a simpler product-card layout.",
    });
  });
});

describe("POST", () => {
  it("streams one valid message update for malformed non-UI model text", async () => {
    const route = await import("./route.ts");
    route.setAgentForTest(
      createStreamingAgent(["This is not JSON and not a UI update."]) as unknown as Parameters<
        typeof route.setAgentForTest
      >[0],
    );

    const response = await POST(
      new Request("http://localhost/api/agent", {
        body: JSON.stringify({ message: "generate concepts", sessionId: "malformed-text" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );

    await expect(readNdjson(response)).resolves.toEqual([
      {
        type: "message",
        text: "This is not JSON and not a UI update.",
      },
    ]);
  });

  it("streams the default message when zero parsed lines and final text is empty", async () => {
    const route = await import("./route.ts");
    route.setAgentForTest(
      createStreamingAgent([""]) as unknown as Parameters<typeof route.setAgentForTest>[0],
    );

    const response = await POST(
      new Request("http://localhost/api/agent", {
        body: JSON.stringify({ message: "generate concepts", sessionId: "empty-text" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );

    await expect(readNdjson(response)).resolves.toEqual([
      {
        type: "message",
        text: "I could not render that as an interactive UI, but I can try again with a simpler product-card layout.",
      },
    ]);
  });

  it("persists the visible fallback message in history", async () => {
    const route = await import("./route.ts");
    const agent = createInspectableAgent([""], []);
    route.setAgentForTest(agent as unknown as Parameters<typeof route.setAgentForTest>[0]);

    const firstResponse = await POST(
      new Request("http://localhost/api/agent", {
        body: JSON.stringify({ message: "generate concepts", sessionId: "fallback-history" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );

    await expect(readNdjson(firstResponse)).resolves.toEqual([
      {
        type: "message",
        text: "I could not render that as an interactive UI, but I can try again with a simpler product-card layout.",
      },
    ]);

    await POST(
      new Request("http://localhost/api/agent", {
        body: JSON.stringify({ message: "try again", sessionId: "fallback-history" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );

    expect(agent.inputs[2]?.messages).toEqual([
      { content: "generate concepts", role: "user" },
      {
        content:
          "I could not render that as an interactive UI, but I can try again with a simpler product-card layout.",
        role: "assistant",
      },
      { content: "try again", role: "user" },
    ]);
  });

  it("streams safe subagent activity when requested", async () => {
    const route = await import("./route.ts");
    route.setAgentForTest(
      createSubagentStreamingAgent() as unknown as Parameters<typeof route.setAgentForTest>[0],
    );

    const response = await POST(
      new Request("http://localhost/api/agent", {
        body: JSON.stringify({
          includeSubagentActivity: true,
          message: "generate concepts",
          sessionId: "subagent-activity",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );

    const updates = await readNdjson(response);
    expect(updates).toContainEqual({ type: "message", text: "done" });
    expect(updates).toContainEqual({
      type: "subagent_activity",
      subagentName: "researcher",
      event: "started",
      task: "Find supporting facts",
    });
    expect(updates).toContainEqual({
      type: "subagent_activity",
      subagentName: "researcher",
      event: "delta",
      text: "Searching",
    });
    expect(updates).toContainEqual({
      type: "subagent_activity",
      subagentName: "researcher",
      event: "delta",
      text: " sources",
    });
    expect(updates).toContainEqual({
      type: "subagent_activity",
      subagentName: "researcher",
      event: "completed",
    });
  });

  it("does not stream subagent activity unless requested", async () => {
    const route = await import("./route.ts");
    route.setAgentForTest(
      createSubagentStreamingAgent() as unknown as Parameters<typeof route.setAgentForTest>[0],
    );

    const response = await POST(
      new Request("http://localhost/api/agent", {
        body: JSON.stringify({ message: "generate concepts", sessionId: "no-activity" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );

    const updates = await readNdjson(response);
    expect(updates).toEqual([{ type: "message", text: "done" }]);
  });
});
