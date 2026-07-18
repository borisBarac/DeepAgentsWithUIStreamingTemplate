import { describe, expect, it } from "bun:test";
import { StructuredOutputParsingError } from "langchain";

import {
  createInteractionStream,
  finalTextToMessageFallback,
  type ModelUiOutput,
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
                text: asyncIterableFrom(["Searching", " sources", '{"status":"ok"}']),
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
      text: "I could not render that as an interactive UI, but I can try again with a simpler layout.",
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

  it("emits only the last UI update for a duplicate rootId", async () => {
    const earlier = textUpdate("same", "Earlier value");
    const final = textUpdate("same", "Final value");
    const agent: FakeAgent = {
      async streamEvents() {
        return {
          messages: asyncIterableFrom([]),
          output: Promise.resolve({
            messages: [],
            structuredResponse: {
              version: 1,
              updates: [earlier, final],
            },
          }),
        };
      },
    };

    await expect(collectUpdates(agent)).resolves.toEqual([final]);
  });
});

describe("createInteractionStream", () => {
  it("repairs only presentation when the two-phase output is invalid", async () => {
    let workCalls = 0;
    let presentationCalls = 0;
    const agent: StreamableAgent = {
      async invoke() {
        throw new Error("not used");
      },
      async streamEvents() {
        workCalls += 1;
        return {
          messages: asyncIterableFrom([{ text: asyncIterableFrom(["work candidate"]) }]),
          output: Promise.resolve({
            messages: [{ content: "work candidate", role: "assistant" }],
            structuredResponse: { invalid: true },
            workResult: { messages: [{ content: "work candidate", role: "assistant" }] },
          }),
        };
      },
      async present({ repairFeedback }) {
        presentationCalls += 1;
        expect(repairFeedback).toContain("invalid_model_output");
        return { version: 1, updates: [{ type: "message", text: "Repaired answer" }] };
      },
    };
    const interaction = createInteractionStream({
      agent,
      messages: [{ content: "Do it", role: "user" }],
      requireStructuredOutput: true,
      sessionId: "presentation-only-repair",
    });
    const updates: UiUpdate[] = [];
    for await (const update of interaction.updates) updates.push(update);

    expect(updates).toEqual([{ type: "message", text: "Repaired answer" }]);
    expect(workCalls).toBe(1);
    expect(presentationCalls).toBe(1);
  });

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

  it("repairs a serialized structured envelope instead of exposing it as message text", async () => {
    const serializedEnvelope = JSON.stringify({
      version: 1,
      updates: [
        {
          type: "ui",
          rootId: "card",
          components: [
            {
              id: "card",
              component: "Card",
              children: [{ id: "title", component: "Text", text: "Headphones" }],
            },
          ],
        },
      ],
    });
    const repaired = textUpdate("card", "Headphones");
    const agent = createStructuredAgent([
      {
        structuredResponse: {
          version: 1,
          updates: [{ type: "message", text: serializedEnvelope }],
        },
      },
      {
        structuredResponse: { version: 1, updates: [repaired] },
      },
    ]);

    const updates = await collectUpdates(agent);

    expect(updates).toEqual([repaired]);
    expect(updates).not.toContainEqual({ type: "message", text: serializedEnvelope });
    expect(agent.inputs).toHaveLength(2);
    expect(agent.inputs[1]?.messages.at(-1)?.content).toContain(
      "updates.0.components.0.children.0",
    );
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

  it("streams the default message when zero parsed lines and final text is empty", async () => {
    await expect(collectUpdates(createStreamingAgent([""]))).resolves.toEqual([
      {
        type: "message",
        text: "I could not render that as an interactive UI, but I can try again with a simpler layout.",
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
            "I could not render that as an interactive UI, but I can try again with a simpler layout.",
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
      event: "delta",
      text: '{"status":"ok"}',
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
  "I could not render that as an interactive UI, but I can try again with a simpler layout.";

function textUpdate(key: string, text: string): Extract<UiUpdate, { type: "ui" }> {
  return {
    type: "ui",
    rootId: key,
    components: [{ id: key, component: "Text", text }],
  };
}

function buttonUpdate(key: string, label: string): Extract<UiUpdate, { type: "ui" }> {
  return {
    type: "ui",
    rootId: key,
    components: [{ id: key, component: "Button", label }],
  };
}

const unknownComponentUpdate = {
  type: "ui",
  rootId: "x",
  components: [{ id: "x", component: "Mystery" }],
};

function uiLine(update: unknown): string {
  return JSON.stringify(update);
}

async function collectRepairUpdates(
  agent: FakeAgent,
  includeActivity = false,
): Promise<{ updates: UiUpdate[]; history: unknown[] }> {
  const interaction = createInteractionStream({
    agent: asStreamable(agent),
    includeActivity,
    messages: [{ content: "build ui", role: "user" }],
    sessionId: "repair-test",
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
          updates: [{ type: "message", text: "Do not leak" }, unknownComponentUpdate],
        },
      },
      {
        structuredResponse: {
          version: 1,
          updates: [{ type: "message", text: "Accepted" }, textUpdate("fixed", "Ready")],
        },
      },
    ]);
    const { updates } = await collectRepairUpdates(agent);

    expect(updates).toEqual([{ type: "message", text: "Accepted" }, textUpdate("fixed", "Ready")]);
    expect(updates).not.toContainEqual({ type: "message", text: "Do not leak" });
  });

  it("repairs rejected UI candidates using path-specific feedback and succeeds on retry", async () => {
    const agent = createInspectableAgent([
      uiLine(unknownComponentUpdate),
      uiLine(textUpdate("text", "fixed")),
    ]);
    const { updates, history } = await collectRepairUpdates(agent);

    expect(updates).toEqual([textUpdate("text", "fixed")]);

    const repairInput = agent.inputs[1];
    expect(repairInput?.messages).toHaveLength(3);
    const feedback = repairInput?.messages[2];
    expect(feedback?.role).toBe("user");
    expect(feedback?.content).toContain("components[0].component");

    const historyMessages = history as Array<{ content: string; role: string }>;
    expect(historyMessages.some((message) => message.content === feedback?.content)).toBe(false);
  });

  it("repairs malformed UI-intended JSON but ignores non-UI malformed lines", async () => {
    const truncatedUi = '{"type":"ui","rootId":"x","components":[{"id":"x","component":"Text"';
    const repairAgent = createInspectableAgent([truncatedUi, uiLine(textUpdate("text", "fixed"))]);
    const { updates } = await collectRepairUpdates(repairAgent);
    expect(updates).toEqual([textUpdate("text", "fixed")]);
    expect(repairAgent.inputs).toHaveLength(2);

    const proseAgent = createInspectableAgent(["This is plain prose, not a UI update."]);
    const { updates: proseUpdates } = await collectRepairUpdates(proseAgent);
    expect(proseUpdates).toEqual([
      { type: "message", text: "This is plain prose, not a UI update." },
    ]);
    expect(proseAgent.inputs).toHaveLength(1);
  });

  it("commits only the accepted repair attempt without duplication", async () => {
    const attempt1 = [uiLine(textUpdate("ok", "kept")), uiLine(unknownComponentUpdate)].join("\n");
    const repair = uiLine(buttonUpdate("btn", "Fixed"));
    const agent = createInspectableAgent([attempt1, repair]);
    const { updates } = await collectRepairUpdates(agent);

    expect(updates).toEqual([buttonUpdate("btn", "Fixed")]);
    expect(agent.inputs).toHaveLength(2);
  });

  it("requests only rejected replacements in the repair feedback", async () => {
    const attempt1 = [uiLine(textUpdate("ok", "kept")), uiLine(unknownComponentUpdate)].join("\n");
    const repair = uiLine(buttonUpdate("btn", "Fixed"));
    const agent = createInspectableAgent([attempt1, repair]);
    await collectRepairUpdates(agent);

    const feedback = agent.inputs[1]?.messages[2]?.content ?? "";
    expect(feedback).toContain("Mystery");
    expect(feedback).not.toContain("kept");
  });

  it("accepts a prose message when the repairing agent cannot produce UI", async () => {
    const agent = createInspectableAgent([
      uiLine(unknownComponentUpdate),
      JSON.stringify({ type: "message", text: "I cannot build that UI, so here is a summary." }),
    ]);
    const { updates } = await collectRepairUpdates(agent);
    expect(updates).toEqual([
      { type: "message", text: "I cannot build that UI, so here is a summary." },
    ]);
  });

  it("keeps repair feedback in agent context but out of saved history", async () => {
    const agent = createInspectableAgent([
      uiLine(unknownComponentUpdate),
      uiLine(textUpdate("text", "fixed")),
    ]);
    const { history } = await collectRepairUpdates(agent);

    const feedback = agent.inputs[1]?.messages[2]?.content ?? "";
    const historyMessages = history as Array<{ content: string; role: string }>;
    expect(historyMessages).toEqual([
      { content: "build ui", role: "user" },
      {
        content: uiLine(textUpdate("text", "fixed")),
        role: "assistant",
      },
    ]);
    expect(historyMessages.some((message) => message.content === feedback)).toBe(false);
  });

  it("emits main-agent activity for both attempts when requested", async () => {
    const agent = createInspectableAgent([
      uiLine(unknownComponentUpdate),
      uiLine(textUpdate("text", "fixed")),
    ]);
    const { updates } = await collectRepairUpdates(agent, true);

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
      uiLine(unknownComponentUpdate),
      uiLine(unknownComponentUpdate),
    ]);
    const { updates } = await collectRepairUpdates(agent);

    expect(updates).toEqual([{ type: "message", text: SAFE_FALLBACK_MESSAGE }]);
    expect(agent.inputs).toHaveLength(2);
  });
});
