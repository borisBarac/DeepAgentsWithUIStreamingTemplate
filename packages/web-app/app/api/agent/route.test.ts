import { afterEach, describe, expect, it } from "bun:test";

import {
  finalTextToMessageFallback,
  type ModelUiOutput,
} from "@deep-agent-template/core/interaction-stream";

import { POST } from "./route.ts";

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

function structuredOutputFromText(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "version" in parsed &&
      "updates" in parsed
    ) {
      return parsed;
    }
    return { version: 1, updates: [parsed] };
  } catch {
    return { version: 1, updates: [{ type: "message", text: trimmed }] };
  }
}

function addStructuredOutput(result: {
  messages: Array<{ content: string; role: "assistant" }>;
  structuredResponse?: unknown;
}): typeof result {
  if (result.structuredResponse !== undefined) return result;
  return {
    ...result,
    structuredResponse: structuredOutputFromText(result.messages.at(-1)?.content ?? ""),
  };
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
        output: output.promise.then(addStructuredOutput),
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
        output: Promise.resolve(
          addStructuredOutput({ messages: [{ content: text, role: "assistant" }] }),
        ),
      };
    },
  };
}

function createStructuredAgent(structuredResponse: unknown): FakeAgent {
  return {
    async streamEvents() {
      return {
        messages: asyncIterableFrom([]),
        output: Promise.resolve({
          messages: [],
          structuredResponse,
        }),
      };
    },
  };
}

function createInspectableStructuredAgent(structuredResponses: unknown[]): InspectableAgent {
  let index = 0;
  const inputs: InspectableAgent["inputs"] = [];
  return {
    inputs,
    async streamEvents(input) {
      if (input) inputs.push(input);
      const structuredResponse =
        structuredResponses[Math.min(index, structuredResponses.length - 1)];
      index += 1;
      return {
        messages: asyncIterableFrom([]),
        output: Promise.resolve({ messages: [], structuredResponse }),
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
        output: output.promise.then(addStructuredOutput),
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
        output: Promise.resolve(
          addStructuredOutput({
            messages: resultMessages ?? [{ content: text, role: "assistant" }],
          }),
        ),
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
        output: Promise.resolve(
          addStructuredOutput({ messages: [{ content: text, role: "assistant" }] }),
        ),
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
        output: Promise.resolve(
          addStructuredOutput({ messages: [{ content: text, role: "assistant" }] }),
        ),
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

async function readWithTimeout<T>(read: Promise<T>, timeoutMs = 20): Promise<T | "timeout"> {
  return await Promise.race([
    read,
    new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), timeoutMs)),
  ]);
}

afterEach(async () => {
  const route = await import("./route.ts");
  route.setAgentFactoryForTest(null);
  route.setAgentForTest(null);
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
      text: "I could not render that as an interactive UI, but I can try again with a simpler layout.",
    });
  });
});

describe("POST", () => {
  it("shares one pending provider initialization across concurrent requests", async () => {
    const route = await import("./route.ts");
    const initialized = createDeferred<Parameters<typeof route.setAgentForTest>[0]>();
    let initializationCount = 0;
    route.setAgentFactoryForTest(async () => {
      initializationCount += 1;
      return (await initialized.promise) as NonNullable<
        Parameters<typeof route.setAgentForTest>[0]
      >;
    });

    const responses = await Promise.all([
      POST(
        new Request("http://localhost/api/agent", {
          body: JSON.stringify({ message: "first", sessionId: "concurrent-init-1" }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      ),
      POST(
        new Request("http://localhost/api/agent", {
          body: JSON.stringify({ message: "second", sessionId: "concurrent-init-2" }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      ),
    ]);

    expect(initializationCount).toBe(1);
    initialized.resolve(
      createStructuredAgent({
        version: 1,
        updates: [{ type: "message", text: "ready" }],
      }) as unknown as NonNullable<Parameters<typeof route.setAgentForTest>[0]>,
    );

    await expect(Promise.all(responses.map(readNdjson))).resolves.toEqual([
      [{ type: "message", text: "ready" }],
      [{ type: "message", text: "ready" }],
    ]);
  });

  it("retries provider initialization after a failure", async () => {
    const route = await import("./route.ts");
    let initializationCount = 0;
    route.setAgentFactoryForTest(async () => {
      initializationCount += 1;
      if (initializationCount === 1) {
        throw new Error("provider initialization failed");
      }
      return createStructuredAgent({
        version: 1,
        updates: [{ type: "message", text: "recovered" }],
      }) as unknown as NonNullable<Parameters<typeof route.setAgentForTest>[0]>;
    });

    const failedResponse = await POST(
      new Request("http://localhost/api/agent", {
        body: JSON.stringify({ message: "first", sessionId: "retry-init-1" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    await expect(readNdjson(failedResponse)).resolves.toEqual([
      { type: "error", message: "provider initialization failed" },
    ]);

    const recoveredResponse = await POST(
      new Request("http://localhost/api/agent", {
        body: JSON.stringify({ message: "second", sessionId: "retry-init-2" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    await expect(readNdjson(recoveredResponse)).resolves.toEqual([
      { type: "message", text: "recovered" },
    ]);
    expect(initializationCount).toBe(2);
  });

  it("persists validated structured output separately from message history", async () => {
    const route = await import("./route.ts");
    const structuredOutput = {
      version: 1,
      updates: [{ type: "message", text: "Structured result" }],
    } satisfies ModelUiOutput;
    route.setAgentForTest(
      createStructuredAgent(structuredOutput) as unknown as Parameters<
        typeof route.setAgentForTest
      >[0],
    );

    const response = await POST(
      new Request("http://localhost/api/agent", {
        body: JSON.stringify({ message: "generate concepts", sessionId: "structured-session" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );

    await expect(readNdjson(response)).resolves.toEqual([
      { type: "message", text: "Structured result" },
    ]);
    expect(route.getSessionStateForTest("structured-session")).toEqual({
      failure: null,
      history: [
        { content: "generate concepts", role: "user" },
        { content: JSON.stringify(structuredOutput), role: "assistant" },
      ],
      structuredOutput,
    });
  });

  it("carries committed structured output into the next turn without repair context", async () => {
    const route = await import("./route.ts");
    const firstOutput = {
      version: 1,
      updates: [
        {
          type: "ui",
          rootId: "one",
          components: [{ id: "one", component: "Text", text: "One" }],
        },
      ],
    };
    const agent = createInspectableStructuredAgent([
      firstOutput,
      { version: 1, updates: [{ type: "message", text: "Updated" }] },
    ]);
    route.setAgentForTest(agent as unknown as Parameters<typeof route.setAgentForTest>[0]);

    await readNdjson(
      await POST(
        new Request("http://localhost/api/agent", {
          body: JSON.stringify({ message: "first", sessionId: "structured-continuation" }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      ),
    );
    await readNdjson(
      await POST(
        new Request("http://localhost/api/agent", {
          body: JSON.stringify({ message: "second", sessionId: "structured-continuation" }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      ),
    );

    const committedFirstOutput = {
      version: 1,
      updates: [
        {
          type: "ui",
          rootId: "one",
          components: [{ id: "one", component: "Text", text: "One" }],
        },
      ],
    };
    expect(agent.inputs[1]?.messages).toEqual([
      { content: "first", role: "user" },
      { content: JSON.stringify(committedFirstOutput), role: "assistant" },
      { content: "second", role: "user" },
    ]);
  });

  it("persists typed structured-output failure state after the bounded retry", async () => {
    const route = await import("./route.ts");
    const invalid = {
      version: 1,
      updates: [{ type: "error", message: "model error" }],
    };
    const agent = createInspectableStructuredAgent([invalid, invalid]);
    route.setAgentForTest(agent as unknown as Parameters<typeof route.setAgentForTest>[0]);

    const response = await POST(
      new Request("http://localhost/api/agent", {
        body: JSON.stringify({ message: "generate", sessionId: "structured-failure-state" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );

    await expect(readNdjson(response)).resolves.toEqual([
      {
        type: "message",
        text: "I could not render that as an interactive UI, but I can try again with a simpler layout.",
      },
    ]);
    expect(route.getSessionStateForTest("structured-failure-state")).toMatchObject({
      failure: { attempts: 2, code: "invalid_model_output" },
      structuredOutput: null,
    });
  });

  it("buffers chunked main-agent output until the run completes", async () => {
    const route = await import("./route.ts");
    const output = createDeferred<{ messages: Array<{ content: string; role: "assistant" }> }>();
    const text = '{"type":"message","text":"chunked"}';
    route.setAgentForTest(
      createBufferedCompletionAgent(
        ['{"type":"message"', ',"text":"chunked"}'],
        output,
      ) as unknown as Parameters<typeof route.setAgentForTest>[0],
    );

    const response = await POST(
      new Request("http://localhost/api/agent", {
        body: JSON.stringify({ message: "generate concepts", sessionId: "chunked-buffered" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );

    if (!response.body) {
      throw new Error("expected response body");
    }
    const reader = response.body.getReader();
    const pendingRead = reader.read();
    await expect(readWithTimeout(pendingRead)).resolves.toBe("timeout");

    output.resolve({ messages: [{ content: text, role: "assistant" }] });

    const first = await pendingRead;
    expect(first.done).toBe(false);
    expect(JSON.parse(new TextDecoder().decode(first.value))).toEqual({
      type: "message",
      text: "chunked",
    });
    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined });
  });

  it("streams main-agent activity before buffered output completes when requested", async () => {
    const route = await import("./route.ts");
    const output = createDeferred<{ messages: Array<{ content: string; role: "assistant" }> }>();
    route.setAgentForTest(
      createBufferedCompletionAgent(["Thinking", " through"], output) as unknown as Parameters<
        typeof route.setAgentForTest
      >[0],
    );

    const response = await POST(
      new Request("http://localhost/api/agent", {
        body: JSON.stringify({
          includeSubagentActivity: true,
          message: "generate concepts",
          sessionId: "main-activity",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );

    if (!response.body) {
      throw new Error("expected response body");
    }

    const reader = response.body.getReader();
    const first = await readWithTimeout(reader.read(), 100);
    expect(first).not.toBe("timeout");
    if (first === "timeout" || first.done) {
      throw new Error("expected debug updates before completion");
    }

    const earlyUpdates = new TextDecoder()
      .decode(first.value)
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as unknown);
    const second = await readWithTimeout(reader.read(), 100);
    expect(second).not.toBe("timeout");
    if (second === "timeout" || second.done) {
      throw new Error("expected main-agent delta before completion");
    }
    earlyUpdates.push(
      ...new TextDecoder()
        .decode(second.value)
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as unknown),
    );

    expect(earlyUpdates).toContainEqual({
      type: "main_agent_activity",
      event: "started",
    });
    expect(earlyUpdates).toContainEqual({
      type: "main_agent_activity",
      event: "delta",
      text: "Thinking",
    });
    expect(earlyUpdates).not.toContainEqual({ type: "message", text: "Thinking through" });

    output.resolve({
      messages: [{ content: '{"type":"message","text":"Thinking through"}\n', role: "assistant" }],
    });
    while (true) {
      const next = await reader.read();
      if (next.done) {
        break;
      }
    }
  });

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
        text: "I could not render that as an interactive UI, but I can try again with a simpler layout.",
      },
    ]);
  });

  it("keeps rejected structured fallback text out of history", async () => {
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
        text: "I could not render that as an interactive UI, but I can try again with a simpler layout.",
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

    const activityUpdates = updates.filter(
      (update): update is { type: "subagent_activity"; subagentRunId: string } =>
        typeof update === "object" &&
        update !== null &&
        "type" in update &&
        update.type === "subagent_activity" &&
        "subagentRunId" in update &&
        typeof update.subagentRunId === "string",
    );
    expect(new Set(activityUpdates.map((update) => update.subagentRunId)).size).toBe(1);
  });

  it("uses a distinct run id for repeated same-name subagent streams", async () => {
    const route = await import("./route.ts");
    route.setAgentForTest(
      createRepeatedSameNameSubagentAgent() as unknown as Parameters<
        typeof route.setAgentForTest
      >[0],
    );

    const response = await POST(
      new Request("http://localhost/api/agent", {
        body: JSON.stringify({
          includeSubagentActivity: true,
          message: "generate concepts",
          sessionId: "repeated-subagent-activity",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );

    const updates = await readNdjson(response);
    const subagentUpdates = updates.filter(
      (
        update,
      ): update is {
        type: "subagent_activity";
        subagentRunId: string;
        event: "started" | "delta" | "completed" | "error";
        task?: string;
        text?: string;
      } =>
        typeof update === "object" &&
        update !== null &&
        "type" in update &&
        update.type === "subagent_activity" &&
        "subagentRunId" in update &&
        typeof update.subagentRunId === "string",
    );
    const ids = [...new Set(subagentUpdates.map((update) => update.subagentRunId))];

    expect(ids).toHaveLength(2);
    for (const id of ids) {
      const runUpdates = subagentUpdates.filter((update) => update.subagentRunId === id);
      expect(runUpdates.map((update) => update.event)).toEqual(["started", "delta", "completed"]);
      expect(new Set(runUpdates.map((update) => update.subagentRunId))).toEqual(new Set([id]));
    }
    expect(subagentUpdates.filter((update) => update.task === "First pass")).toHaveLength(1);
    expect(subagentUpdates.filter((update) => update.task === "Second pass")).toHaveLength(1);
  });

  it("streams requested subagent activity before buffered main output completes", async () => {
    const route = await import("./route.ts");
    const output = createDeferred<{ messages: Array<{ content: string; role: "assistant" }> }>();
    route.setAgentForTest(
      createLiveSubagentAgent(output) as unknown as Parameters<typeof route.setAgentForTest>[0],
    );

    const response = await POST(
      new Request("http://localhost/api/agent", {
        body: JSON.stringify({
          includeSubagentActivity: true,
          message: "generate concepts",
          sessionId: "live-activity",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );

    if (!response.body) {
      throw new Error("expected response body");
    }
    const reader = response.body.getReader();
    const first = await readWithTimeout(reader.read(), 100);
    expect(first).not.toBe("timeout");
    if (first === "timeout" || first.done) {
      throw new Error("expected subagent update before completion");
    }

    const earlyUpdates = new TextDecoder()
      .decode(first.value)
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as unknown);
    const second = await readWithTimeout(reader.read(), 100);
    expect(second).not.toBe("timeout");
    if (second === "timeout" || second.done) {
      throw new Error("expected subagent update before completion");
    }
    earlyUpdates.push(
      ...new TextDecoder()
        .decode(second.value)
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as unknown),
    );
    expect(earlyUpdates).toContainEqual({
      type: "subagent_activity",
      subagentRunId: expect.any(String),
      subagentName: "researcher",
      event: "started",
      task: "Find supporting facts",
    });
    expect(earlyUpdates).not.toContainEqual({ type: "message", text: "done" });

    output.resolve({
      messages: [{ content: '{"type":"message","text":"done"}\n', role: "assistant" }],
    });
    while (true) {
      const next = await reader.read();
      if (next.done) {
        break;
      }
    }
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
