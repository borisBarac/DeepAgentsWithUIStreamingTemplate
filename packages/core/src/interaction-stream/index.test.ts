import { describe, expect, it } from "bun:test";

import {
  createInteractionStream,
  finalTextToMessageFallback,
  productBatchTextToUiUpdates,
  type StreamableAgent,
  type UiUpdate,
} from "./index.ts";

type FakeStreamRun = {
  messages: AsyncIterable<{
    text: AsyncIterable<string>;
  }>;
  subagents?: AsyncIterable<{
    name?: string;
    subagentName?: string;
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

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function asyncIterableFrom<T>(items: T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) {
        yield item;
      }
    },
  };
}

function asStreamable(agent: FakeAgent): StreamableAgent {
  return agent as unknown as StreamableAgent;
}

function createBufferedCompletionAgent(
  chunks: string[],
  output: Deferred<{ messages: Array<{ content: string; role: "assistant" }> }>,
): FakeAgent {
  return {
    async streamEvents() {
      return {
        messages: asyncIterableFrom([
          {
            text: asyncIterableFrom(chunks),
          },
        ]),
        output: output.promise,
      };
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

function createLiveSubagentAgent(
  output: Deferred<{ messages: Array<{ content: string; role: "assistant" }> }>,
): FakeAgent {
  const text = '{"type":"message","text":"done"}\n';
  return {
    async streamEvents() {
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
            messages: asyncIterableFrom([]),
            output: Promise.resolve({}),
          },
        ]),
        output: output.promise,
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

function createRepeatedSameNameSubagentAgent(): FakeAgent {
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
            taskInput: "First pass",
            messages: asyncIterableFrom([
              {
                text: asyncIterableFrom(["First"]),
              },
            ]),
            output: Promise.resolve({}),
          },
          {
            name: "researcher",
            taskInput: "Second pass",
            messages: asyncIterableFrom([
              {
                text: asyncIterableFrom(["Second"]),
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

async function collectUpdates(agent: FakeAgent, includeActivity = false): Promise<UiUpdate[]> {
  const interaction = createInteractionStream({
    agent: asStreamable(agent),
    includeActivity,
    messages: [{ content: "generate concepts", role: "user" }],
    sessionId: "test-session",
  });
  const updates: UiUpdate[] = [];
  for await (const update of interaction.updates) {
    updates.push(update);
  }
  await interaction.result;
  return updates;
}

async function readWithTimeout<T>(read: Promise<T>, timeoutMs = 20): Promise<T | "timeout"> {
  return await Promise.race([
    read,
    new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), timeoutMs)),
  ]);
}

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
          },
        },
      },
    });
    expect(updates[1]?.type).toBe("ui");
    if (updates[1]?.type !== "ui") throw new Error("expected ui update");
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

describe("createInteractionStream", () => {
  it("buffers chunked main-agent output until the run completes", async () => {
    const output = createDeferred<{ messages: Array<{ content: string; role: "assistant" }> }>();
    const text = '{"type":"message","text":"chunked"}';
    const interaction = createInteractionStream({
      agent: asStreamable(
        createBufferedCompletionAgent(['{"type":"message"', ',"text":"chunked"}'], output),
      ),
      messages: [{ content: "generate concepts", role: "user" }],
      sessionId: "chunked-buffered",
    });
    const iterator = interaction.updates[Symbol.asyncIterator]();
    const pendingRead = iterator.next();
    await expect(readWithTimeout(pendingRead)).resolves.toBe("timeout");

    output.resolve({ messages: [{ content: text, role: "assistant" }] });

    await expect(pendingRead).resolves.toEqual({
      done: false,
      value: { type: "message", text: "chunked" },
    });
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
  });

  it("streams main-agent activity before buffered output completes when requested", async () => {
    const output = createDeferred<{ messages: Array<{ content: string; role: "assistant" }> }>();
    const interaction = createInteractionStream({
      agent: asStreamable(createBufferedCompletionAgent(["Thinking", " through"], output)),
      includeActivity: true,
      messages: [{ content: "generate concepts", role: "user" }],
      sessionId: "main-activity",
    });
    const iterator = interaction.updates[Symbol.asyncIterator]();

    await expect(readWithTimeout(iterator.next(), 100)).resolves.toEqual({
      done: false,
      value: { type: "main_agent_activity", event: "started" },
    });
    await expect(readWithTimeout(iterator.next(), 100)).resolves.toEqual({
      done: false,
      value: { type: "main_agent_activity", event: "delta", text: "Thinking" },
    });

    output.resolve({
      messages: [{ content: '{"type":"message","text":"Thinking through"}\n', role: "assistant" }],
    });
    for await (const _ of { [Symbol.asyncIterator]: () => iterator }) {
      void _;
    }
  });

  it("streams one valid message update for malformed non-UI model text", async () => {
    await expect(
      collectUpdates(createStreamingAgent(["This is not JSON and not a UI update."])),
    ).resolves.toEqual([
      {
        type: "message",
        text: "This is not JSON and not a UI update.",
      },
    ]);
  });

  it("converts product batches before retrying malformed output", async () => {
    await expect(
      collectUpdates(
        createStreamingAgent([
          JSON.stringify({
            products: [{ id: "concept-1", title: "Concept", description: "Description" }],
          }),
        ]),
      ),
    ).resolves.toEqual([
      {
        type: "ui",
        spec: {
          root: "concept-1",
          elements: {
            "concept-1": {
              type: "product-card",
              props: { id: "concept-1", title: "Concept", description: "Description" },
            },
          },
        },
      },
    ]);
  });

  it("streams the default message when zero parsed lines and final text is empty", async () => {
    await expect(collectUpdates(createStreamingAgent([""]))).resolves.toEqual([
      {
        type: "message",
        text: "I could not render that as an interactive UI, but I can try again with a simpler product-card layout.",
      },
    ]);
  });

  it("persists the visible fallback message in history", async () => {
    const agent = createInspectableAgent([""], []);
    const interaction = createInteractionStream({
      agent: asStreamable(agent),
      messages: [{ content: "generate concepts", role: "user" }],
      sessionId: "fallback-history",
    });
    for await (const _ of interaction.updates) {
      void _;
    }

    await expect(interaction.result).resolves.toMatchObject({
      history: [
        { content: "generate concepts", role: "user" },
        {
          content:
            "I could not render that as an interactive UI, but I can try again with a simpler product-card layout.",
          role: "assistant",
        },
      ],
    });
  });

  it("streams safe subagent activity when requested", async () => {
    const updates = await collectUpdates(createSubagentStreamingAgent(), true);
    expect(updates).toContainEqual({ type: "message", text: "done" });
    expect(updates).toContainEqual({
      type: "subagent_activity",
      subagentRunId: expect.any(String),
      subagentName: "researcher",
      event: "started",
      task: "Find supporting facts",
    });
    expect(updates).toContainEqual({
      type: "subagent_activity",
      subagentRunId: expect.any(String),
      subagentName: "researcher",
      event: "delta",
      text: "Searching",
    });
    expect(updates).toContainEqual({
      type: "subagent_activity",
      subagentRunId: expect.any(String),
      subagentName: "researcher",
      event: "delta",
      text: " sources",
    });
    expect(updates).toContainEqual({
      type: "subagent_activity",
      subagentRunId: expect.any(String),
      subagentName: "researcher",
      event: "completed",
    });
  });

  it("uses a distinct run id for repeated same-name subagent streams", async () => {
    const updates = await collectUpdates(createRepeatedSameNameSubagentAgent(), true);
    const subagentUpdates = updates.filter(
      (
        update,
      ): update is {
        type: "subagent_activity";
        subagentRunId: string;
        subagentName: string;
        event: "started" | "delta" | "completed" | "error";
        task?: string;
      } =>
        update.type === "subagent_activity" &&
        "subagentRunId" in update &&
        typeof update.subagentRunId === "string",
    );
    const ids = [...new Set(subagentUpdates.map((update) => update.subagentRunId))];

    expect(ids).toHaveLength(2);
    for (const id of ids) {
      const runUpdates = subagentUpdates.filter((update) => update.subagentRunId === id);
      expect(runUpdates.map((update) => update.event)).toEqual(["started", "delta", "completed"]);
    }
    expect(subagentUpdates.filter((update) => update.task === "First pass")).toHaveLength(1);
    expect(subagentUpdates.filter((update) => update.task === "Second pass")).toHaveLength(1);
  });

  it("streams requested subagent activity before buffered main output completes", async () => {
    const output = createDeferred<{ messages: Array<{ content: string; role: "assistant" }> }>();
    const interaction = createInteractionStream({
      agent: asStreamable(createLiveSubagentAgent(output)),
      includeActivity: true,
      messages: [{ content: "generate concepts", role: "user" }],
      sessionId: "live-activity",
    });
    const iterator = interaction.updates[Symbol.asyncIterator]();

    const earlyUpdates: UiUpdate[] = [];
    for (let index = 0; index < 3; index += 1) {
      const next = await readWithTimeout(iterator.next(), 100);
      expect(next).not.toBe("timeout");
      if (next === "timeout" || next.done) {
        throw new Error("expected early activity before completion");
      }
      earlyUpdates.push(next.value);
    }
    expect(earlyUpdates).toContainEqual(
      expect.objectContaining({
        type: "subagent_activity",
        subagentName: "researcher",
        event: "started",
      }),
    );

    output.resolve({
      messages: [{ content: '{"type":"message","text":"done"}\n', role: "assistant" }],
    });
    for await (const _ of { [Symbol.asyncIterator]: () => iterator }) {
      void _;
    }
  });

  it("does not stream subagent activity unless requested", async () => {
    await expect(collectUpdates(createSubagentStreamingAgent())).resolves.toEqual([
      { type: "message", text: "done" },
    ]);
  });
});
