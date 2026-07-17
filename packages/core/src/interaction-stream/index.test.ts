import { describe, expect, it } from "bun:test";
import { StructuredOutputParsingError } from "langchain";

import { validateStreamingSpec } from "../generative-ui/contract.ts";
import {
  createInteractionStream,
  finalTextToMessageFallback,
  type ModelUiOutput,
  productBatchTextToUiUpdates,
  type StreamableAgent,
  type UiUpdate,
  type ValidateSpec,
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
  output: Promise<{
    messages: Array<{ content: string; role: "assistant" }>;
    structuredResponse?: unknown;
  }>;
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

function createStructuredAgent(
  outputs: Array<{ structuredResponse: unknown; text?: string }>,
): InspectableAgent {
  let index = 0;
  const inputs: InspectableAgent["inputs"] = [];
  return {
    inputs,
    async streamEvents(input) {
      if (input) inputs.push(input);
      const output = outputs[Math.min(index, outputs.length - 1)] ?? {
        structuredResponse: undefined,
      };
      index += 1;
      const text = output.text ?? "";
      return {
        messages: asyncIterableFrom([{ text: asyncIterableFrom([text]) }]),
        output: Promise.resolve({
          messages: [{ content: text, role: "assistant" }],
          structuredResponse: output.structuredResponse,
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

describe("workflow delivery streaming", () => {
  it("keeps intermediate narration out of the visible result", async () => {
    const agent = createInspectableAgent(
      ["I will route this through clarification."],
      [{ content: "Reviewed final response", role: "assistant" }],
    );
    const interaction = createInteractionStream({
      agent: asStreamable(agent),
      messages: [{ content: "build it", role: "user" }],
      sessionId: "accepted-final",
    });
    for await (const _update of interaction.updates) {
      /* drain */
    }
    expect((await interaction.result).finalText).toBe("Reviewed final response");
  });

  it("emits product-generator batches even when debug activity is disabled", async () => {
    const batch = JSON.stringify({
      products: [{ id: "board", title: "Kanban board", description: "Four-column office board" }],
    });
    const agent: FakeAgent = {
      async streamEvents() {
        return {
          messages: asyncIterableFrom([{ text: asyncIterableFrom(["Reviewed final response"]) }]),
          subagents: asyncIterableFrom([
            {
              name: "product-generator",
              output: Promise.resolve({ messages: [{ content: batch, role: "assistant" }] }),
            },
          ]),
          output: Promise.resolve({
            messages: [{ content: "Reviewed final response", role: "assistant" }],
          }),
        };
      },
    };
    const updates = await collectUpdates(agent);
    expect(updates.some((update) => update.type === "ui")).toBeTrue();
    expect(
      updates.some(
        (update) => update.type === "message" && update.text === "Reviewed final response",
      ),
    ).toBeTrue();
  });

  it("prefers a product-generator structured response over its assistant text", async () => {
    const agent: FakeAgent = {
      async streamEvents() {
        return {
          messages: asyncIterableFrom([]),
          subagents: asyncIterableFrom([
            {
              name: "product-generator",
              output: Promise.resolve({
                messages: [{ content: "not json", role: "assistant" }],
                structuredResponse: {
                  products: [
                    { id: "structured", title: "Structured card", description: "Accepted" },
                  ],
                },
              }),
            },
          ]),
          output: Promise.resolve({
            messages: [],
            structuredResponse: {
              version: 1,
              updates: [{ type: "message", text: "Done" }],
            },
          }),
        };
      },
    };

    const updates = await collectUpdates(agent);
    expect(updates).toContainEqual(expect.objectContaining({ type: "ui" }));
    expect(updates).toContainEqual({ type: "message", text: "Done" });
  });

  it("emits only the last UI update for a duplicate spec root", async () => {
    const batch = JSON.stringify({
      products: [{ id: "same", title: "Product agent", description: "Earlier value" }],
    });
    const supervisorSpec = {
      root: "same",
      elements: {
        same: {
          type: "product-card",
          props: { id: "same", title: "Supervisor", description: "Final value" },
        },
      },
    };
    const agent: FakeAgent = {
      async streamEvents() {
        return {
          messages: asyncIterableFrom([]),
          subagents: asyncIterableFrom([
            {
              name: "product-generator",
              output: Promise.resolve({ messages: [{ content: batch, role: "assistant" }] }),
            },
          ]),
          output: Promise.resolve({
            messages: [],
            structuredResponse: {
              version: 1,
              updates: [{ type: "ui", spec: supervisorSpec }],
            },
          }),
        };
      },
    };

    await expect(collectUpdates(agent)).resolves.toEqual([{ type: "ui", spec: supervisorSpec }]);
  });

  it("accepts a maximum product batch plus a supervisor message", async () => {
    let calls = 0;
    const products = Array.from({ length: 32 }, (_, index) => ({
      id: `card-${index}`,
      title: `Card ${index}`,
      description: "Description",
    }));
    const agent: FakeAgent = {
      async streamEvents() {
        calls += 1;
        return {
          messages: asyncIterableFrom([]),
          subagents: asyncIterableFrom([
            {
              name: "product-generator",
              output: Promise.resolve({ structuredResponse: { products } }),
            },
          ]),
          output: Promise.resolve({
            messages: [],
            structuredResponse: {
              version: 1,
              updates: [{ type: "message", text: "All products generated" }],
            },
          }),
        };
      },
    };
    const interaction = createInteractionStream({
      agent: asStreamable(agent),
      messages: [{ content: "generate concepts", role: "user" }],
      requireStructuredOutput: true,
      sessionId: "combined-update-cap",
    });
    const updates: UiUpdate[] = [];
    for await (const update of interaction.updates) updates.push(update);
    const result = await interaction.result;

    expect(updates).toHaveLength(33);
    expect(updates.at(-1)).toEqual({ type: "message", text: "All products generated" });
    expect(calls).toBe(1);
    expect(result.failure).toBeNull();
  });

  it("deduplicates a repeated supervisor product after merging bounded outputs", async () => {
    const products = Array.from({ length: 32 }, (_, index) => ({
      id: `card-${index}`,
      title: `Card ${index}`,
      description: "Earlier value",
    }));
    const finalSpec = {
      root: "card-0",
      elements: {
        "card-0": {
          type: "product-card",
          props: {
            id: "card-0",
            title: "Updated card",
            description: "Final value",
          },
        },
      },
    };
    const agent: FakeAgent = {
      async streamEvents() {
        return {
          messages: asyncIterableFrom([]),
          subagents: asyncIterableFrom([
            {
              name: "product-generator",
              output: Promise.resolve({ structuredResponse: { products } }),
            },
          ]),
          output: Promise.resolve({
            messages: [],
            structuredResponse: {
              version: 1,
              updates: [{ type: "ui", spec: finalSpec }],
            },
          }),
        };
      },
    };

    const updates = await collectUpdates(agent);

    expect(updates).toHaveLength(32);
    expect(
      updates.filter((update) => update.type === "ui" && update.spec.root === "card-0"),
    ).toEqual([{ type: "ui", spec: finalSpec }]);
  });
});

describe("createInteractionStream", () => {
  it("prefers validated structured output over conflicting assistant prose", async () => {
    const structuredOutput = {
      version: 1,
      updates: [{ type: "message", text: "Structured answer" }],
    } satisfies ModelUiOutput;
    const interaction = createInteractionStream({
      agent: asStreamable(
        createStructuredAgent([
          {
            structuredResponse: structuredOutput,
            text: '{"type":"message","text":"Legacy answer"}',
          },
        ]),
      ),
      messages: [{ content: "generate concepts", role: "user" }],
      sessionId: "structured-precedence",
    });
    const updates: UiUpdate[] = [];
    for await (const update of interaction.updates) updates.push(update);

    expect(updates).toEqual([{ type: "message", text: "Structured answer" }]);
    expect((await interaction.result).structuredOutput).toEqual(structuredOutput);
  });

  it("retries an invalid structured object once with validation feedback", async () => {
    const agent = createStructuredAgent([
      {
        structuredResponse: {
          version: 1,
          updates: [{ type: "error", message: "model-owned error" }],
        },
      },
      {
        structuredResponse: {
          version: 1,
          updates: [{ type: "message", text: "Corrected answer" }],
        },
      },
    ]);
    const updates = await collectUpdates(agent);

    expect(updates).toEqual([{ type: "message", text: "Corrected answer" }]);
    expect(agent.inputs).toHaveLength(2);
    expect(agent.inputs[1]?.messages.at(-1)?.content).toContain("updates.0.type");
  });

  it("returns a typed failure after the corrected structured object is still invalid", async () => {
    const invalid = {
      version: 1,
      updates: [{ type: "main_agent_activity", event: "completed" }],
    };
    const agent = createStructuredAgent([
      { structuredResponse: invalid },
      { structuredResponse: invalid },
    ]);
    const interaction = createInteractionStream({
      agent: asStreamable(agent),
      messages: [{ content: "generate concepts", role: "user" }],
      sessionId: "structured-failure",
    });
    const updates: UiUpdate[] = [];
    for await (const update of interaction.updates) updates.push(update);
    const result = await interaction.result;

    expect(updates).toEqual([{ type: "message", text: SAFE_FALLBACK_MESSAGE }]);
    expect(agent.inputs).toHaveLength(2);
    expect(result.structuredOutput).toBeNull();
    expect(result.failure).toMatchObject({
      code: "invalid_model_output",
      attempts: 2,
      issues: [expect.objectContaining({ path: "updates.0.type" })],
    });
  });

  it("centrally retries a structured parsing error with corrected-object feedback", async () => {
    const agent = createStructuredAgent([
      {
        structuredResponse: {
          version: 1,
          updates: [{ type: "message", text: "Recovered answer" }],
        },
      },
    ]);
    const delegate = agent.streamEvents;
    let calls = 0;
    agent.streamEvents = async (input) => {
      calls += 1;
      if (calls === 1) {
        if (input) agent.inputs.push(input);
        return {
          messages: asyncIterableFrom([]),
          output: Promise.reject(
            new Error("inner middleware", {
              cause: new StructuredOutputParsingError("providerStrategy", ["bad"]),
            }),
          ),
        };
      }
      return delegate(input);
    };

    await expect(collectUpdates(agent)).resolves.toEqual([
      { type: "message", text: "Recovered answer" },
    ]);
    expect(agent.inputs).toHaveLength(2);
    expect(agent.inputs[1]?.messages.at(-1)?.content).toContain("complete corrected JSON object");
  });

  it("waits for failed-attempt streams to settle before starting the repair", async () => {
    const drain = createDeferred<void>();
    let calls = 0;
    const agent: FakeAgent = {
      async streamEvents() {
        calls += 1;
        if (calls === 1) {
          return {
            messages: {
              [Symbol.asyncIterator]() {
                return {
                  async next() {
                    await drain.promise;
                    return { done: true as const, value: undefined };
                  },
                };
              },
            },
            output: Promise.reject(new StructuredOutputParsingError("providerStrategy", ["bad"])),
          };
        }
        return {
          messages: asyncIterableFrom([]),
          output: Promise.resolve({
            messages: [],
            structuredResponse: {
              version: 1,
              updates: [{ type: "message", text: "Recovered" }],
            },
          }),
        };
      },
    };
    const interaction = createInteractionStream({
      agent: asStreamable(agent),
      messages: [{ content: "generate concepts", role: "user" }],
      requireStructuredOutput: true,
      sessionId: "settled-repair",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toBe(1);

    drain.resolve();
    const updates: UiUpdate[] = [];
    for await (const update of interaction.updates) updates.push(update);
    expect(updates).toEqual([{ type: "message", text: "Recovered" }]);
    expect(calls).toBe(2);
  });

  it("rejects missing structured output instead of accepting model-owned activity", async () => {
    const agent = createInspectableAgent([
      '{"type":"main_agent_activity","event":"completed"}',
      '{"type":"main_agent_activity","event":"completed"}',
    ]);
    const interaction = createInteractionStream({
      agent: asStreamable(agent),
      messages: [{ content: "generate concepts", role: "user" }],
      requireStructuredOutput: true,
      sessionId: "required-structured-output",
    });
    const updates: UiUpdate[] = [];
    for await (const update of interaction.updates) updates.push(update);
    const result = await interaction.result;

    expect(updates).toEqual([{ type: "message", text: SAFE_FALLBACK_MESSAGE }]);
    expect(updates.some((update) => update.type === "main_agent_activity")).toBeFalse();
    expect(agent.inputs).toHaveLength(2);
    expect(result.failure).toMatchObject({ code: "invalid_model_output", attempts: 2 });
  });

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

const SAFE_FALLBACK_MESSAGE =
  "I could not render that as an interactive UI, but I can try again with a simpler product-card layout.";

function textSpec(
  key: string,
  text: string,
): {
  root: string;
  elements: Record<string, { type: string; props: Record<string, unknown>; children: string[] }>;
} {
  return {
    root: key,
    elements: { [key]: { type: "Text", props: { text }, children: [] } },
  };
}

function buttonSpec(
  key: string,
  label: string,
): {
  root: string;
  elements: Record<string, { type: string; props: Record<string, unknown>; children: string[] }>;
} {
  return {
    root: key,
    elements: { [key]: { type: "Button", props: { label }, children: [] } },
  };
}

const unknownComponentSpec = {
  root: "x",
  elements: { x: { type: "Mystery", props: {}, children: [] } },
};

function uiLine(spec: unknown): string {
  return JSON.stringify({ type: "ui", spec });
}

async function collectWithValidator(
  agent: FakeAgent,
  validateSpec: ValidateSpec,
  includeActivity = false,
): Promise<{ updates: UiUpdate[]; history: unknown[] }> {
  const interaction = createInteractionStream({
    agent: asStreamable(agent),
    includeActivity,
    messages: [{ content: "build ui", role: "user" }],
    sessionId: "repair-test",
    validateSpec,
  });
  const updates: UiUpdate[] = [];
  for await (const update of interaction.updates) {
    updates.push(update);
  }
  const result = await interaction.result;
  return { updates, history: result.history };
}

describe("createInteractionStream — NDJSON UI repair", () => {
  it("commits structured attempts atomically after catalog validation", async () => {
    const agent = createStructuredAgent([
      {
        structuredResponse: {
          version: 1,
          updates: [
            { type: "message", text: "Do not leak" },
            { type: "ui", spec: unknownComponentSpec },
          ],
        },
      },
      {
        structuredResponse: {
          version: 1,
          updates: [
            { type: "message", text: "Accepted" },
            { type: "ui", spec: textSpec("fixed", "Ready") },
          ],
        },
      },
    ]);
    const { updates } = await collectWithValidator(agent, validateStreamingSpec);

    expect(updates).toEqual([
      { type: "message", text: "Accepted" },
      { type: "ui", spec: textSpec("fixed", "Ready") },
    ]);
    expect(updates).not.toContainEqual({ type: "message", text: "Do not leak" });
  });

  it("repairs rejected UI candidates using path-specific feedback and succeeds on retry", async () => {
    const agent = createInspectableAgent([
      uiLine(unknownComponentSpec),
      uiLine(textSpec("text", "fixed")),
    ]);
    const { updates, history } = await collectWithValidator(agent, validateStreamingSpec);

    expect(updates).toEqual([{ type: "ui", spec: textSpec("text", "fixed") }]);

    const repairInput = agent.inputs[1];
    expect(repairInput?.messages).toHaveLength(3);
    const feedback = repairInput?.messages[2];
    expect(feedback?.role).toBe("user");
    expect(feedback?.content).toContain("elements.x.type");

    const historyMessages = history as Array<{ content: string; role: string }>;
    expect(historyMessages.some((message) => message.content === feedback?.content)).toBe(false);
  });

  it("repairs malformed UI-intended JSON but ignores non-UI malformed lines", async () => {
    const truncatedUi = '{"type":"ui","spec":{"root":"x","elements":{"x":{"type":"Text"';
    const repairAgent = createInspectableAgent([truncatedUi, uiLine(textSpec("text", "fixed"))]);
    const { updates } = await collectWithValidator(repairAgent, validateStreamingSpec);
    expect(updates).toEqual([{ type: "ui", spec: textSpec("text", "fixed") }]);
    expect(repairAgent.inputs).toHaveLength(2);

    const proseAgent = createInspectableAgent(["This is plain prose, not a UI update."]);
    const { updates: proseUpdates } = await collectWithValidator(proseAgent, validateStreamingSpec);
    expect(proseUpdates).toEqual([
      { type: "message", text: "This is plain prose, not a UI update." },
    ]);
    expect(proseAgent.inputs).toHaveLength(1);
  });

  it("commits only the accepted repair attempt without duplication", async () => {
    const attempt1 = [uiLine(textSpec("ok", "kept")), uiLine(unknownComponentSpec)].join("\n");
    const repair = uiLine(buttonSpec("btn", "Fixed"));
    const agent = createInspectableAgent([attempt1, repair]);
    const { updates } = await collectWithValidator(agent, validateStreamingSpec);

    expect(updates).toEqual([{ type: "ui", spec: buttonSpec("btn", "Fixed") }]);
    expect(agent.inputs).toHaveLength(2);
  });

  it("requests only rejected replacements in the repair feedback", async () => {
    const attempt1 = [uiLine(textSpec("ok", "kept")), uiLine(unknownComponentSpec)].join("\n");
    const repair = uiLine(buttonSpec("btn", "Fixed"));
    const agent = createInspectableAgent([attempt1, repair]);
    await collectWithValidator(agent, validateStreamingSpec);

    const feedback = agent.inputs[1]?.messages[2]?.content ?? "";
    expect(feedback).toContain("Mystery");
    expect(feedback).not.toContain("kept");
  });

  it("accepts a prose message when the repairing agent cannot produce UI", async () => {
    const agent = createInspectableAgent([
      uiLine(unknownComponentSpec),
      JSON.stringify({ type: "message", text: "I cannot build that UI, so here is a summary." }),
    ]);
    const { updates } = await collectWithValidator(agent, validateStreamingSpec);
    expect(updates).toEqual([
      { type: "message", text: "I cannot build that UI, so here is a summary." },
    ]);
  });

  it("keeps repair feedback in agent context but out of saved history", async () => {
    const agent = createInspectableAgent([
      uiLine(unknownComponentSpec),
      uiLine(textSpec("text", "fixed")),
    ]);
    const { history } = await collectWithValidator(agent, validateStreamingSpec);

    const feedback = agent.inputs[1]?.messages[2]?.content ?? "";
    const historyMessages = history as Array<{ content: string; role: string }>;
    expect(historyMessages).toEqual([
      { content: "build ui", role: "user" },
      { content: uiLine(textSpec("text", "fixed")), role: "assistant" },
    ]);
    expect(historyMessages.some((message) => message.content === feedback)).toBe(false);
  });

  it("emits main-agent activity for both attempts when requested", async () => {
    const agent = createInspectableAgent([
      uiLine(unknownComponentSpec),
      uiLine(textSpec("text", "fixed")),
    ]);
    const { updates } = await collectWithValidator(agent, validateStreamingSpec, true);

    const started = updates.filter(
      (update): update is Extract<UiUpdate, { type: "main_agent_activity" }> =>
        update.type === "main_agent_activity" && update.event === "started",
    );
    const completed = updates.filter(
      (update): update is Extract<UiUpdate, { type: "main_agent_activity" }> =>
        update.type === "main_agent_activity" && update.event === "completed",
    );
    expect(started).toHaveLength(2);
    expect(completed).toHaveLength(2);
    expect(updates.some((update) => update.type === "ui")).toBe(true);
  });

  it("emits the safe prose fallback and stops when repair also fails", async () => {
    const agent = createInspectableAgent([
      uiLine(unknownComponentSpec),
      uiLine(unknownComponentSpec),
    ]);
    const { updates } = await collectWithValidator(agent, validateStreamingSpec);

    expect(updates).toEqual([{ type: "message", text: SAFE_FALLBACK_MESSAGE }]);
    expect(agent.inputs).toHaveLength(2);
  });
});
