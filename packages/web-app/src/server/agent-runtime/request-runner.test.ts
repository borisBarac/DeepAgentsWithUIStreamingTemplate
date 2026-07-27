import { describe, expect, it } from "bun:test";

import type {
  AgentInputMessage,
  StreamableAgent,
  UiUpdate,
} from "@deep-agent-template/core/interaction-stream";
import { InlineAgentExecutor } from "./executor.ts";
import { AgentRequestRunner } from "./request-runner.ts";
import { InMemorySessionStore } from "./store.ts";
import type { ExecutionResult } from "./types.ts";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (e: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function asyncIterableFrom<T>(items: T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}

function structuredFromText(text: string): {
  version: 1;
  updates: [{ type: "message"; text: string }];
} {
  return { version: 1, updates: [{ type: "message", text }] };
}

type FakeAgent = StreamableAgent & {
  recordedThreadIds: string[];
  recordedMessages: AgentInputMessage[][];
};

function fakeAgent(options: {
  structuredResponse?: unknown;
  streamText?: string;
  output?: Deferred<{ messages: never[] }>;
}): FakeAgent {
  const recordedThreadIds: string[] = [];
  const recordedMessages: AgentInputMessage[][] = [];
  return {
    invoke: async () => ({ messages: [] }),
    recordedThreadIds,
    recordedMessages,
    async streamEvents(input, config) {
      recordedThreadIds.push(config.configurable.thread_id);
      recordedMessages.push(input.messages);
      return {
        messages: asyncIterableFrom([
          { text: asyncIterableFrom(options.streamText ? [options.streamText] : []) },
        ]),
        output: options.output
          ? options.output.promise.then(() => ({
              messages: [],
              structuredResponse: options.structuredResponse,
            }))
          : Promise.resolve({ messages: [], structuredResponse: options.structuredResponse }),
      };
    },
  };
}

function makeAgentRequestRunner(agent: FakeAgent | (() => FakeAgent)) {
  const store = new InMemorySessionStore();
  const getAgent = typeof agent === "function" ? agent : () => agent;
  const executor = new InlineAgentExecutor({ agentSource: async () => getAgent() });
  const runner = new AgentRequestRunner({ executor, store });
  return { store, runner };
}

const ID_A = { tenantId: "tenant-a", userId: "user-1" };
const ID_B = { tenantId: "tenant-b", userId: "user-2" };

async function drain(updates: AsyncIterable<UiUpdate>): Promise<UiUpdate[]> {
  const collected: UiUpdate[] = [];
  for await (const update of updates) collected.push(update);
  return collected;
}

describe("AgentRequestRunner tenant isolation", () => {
  it("isolates history, thread key, and output by identity", async () => {
    const agent = fakeAgent({ structuredResponse: structuredFromText("hello") });
    const { store, runner } = makeAgentRequestRunner(agent);

    const hA = runner.run(
      { identity: ID_A, includeActivity: false, message: "from-a", sessionId: "shared" },
      new AbortController().signal,
    );
    await drain(hA.updates);
    await hA.result;

    const hB = runner.run(
      { identity: ID_B, includeActivity: false, message: "from-b", sessionId: "shared" },
      new AbortController().signal,
    );
    await drain(hB.updates);
    await hB.result;

    const sessionA = store.loadSession(ID_A, "shared");
    const sessionB = store.loadSession(ID_B, "shared");
    expect(sessionA?.history?.[0]).toEqual({ content: "from-a", role: "user" });
    expect(sessionB?.history?.[0]).toEqual({ content: "from-b", role: "user" });
    expect(sessionA?.structuredOutput).toEqual(structuredFromText("hello"));
    expect(sessionB?.structuredOutput).toEqual(structuredFromText("hello"));

    // Workflow state is scoped by a collision-proof thread key derived from identity.
    expect(agent.recordedThreadIds).toHaveLength(2);
    expect(agent.recordedThreadIds[0]).not.toBe(agent.recordedThreadIds[1]);
  });

  it("carries committed history into the next turn for the same identity", async () => {
    const agent = fakeAgent({
      structuredResponse: structuredFromText("second"),
    });
    const { runner } = makeAgentRequestRunner(agent);

    const first = runner.run(
      { identity: ID_A, includeActivity: false, message: "first", sessionId: "s1" },
      new AbortController().signal,
    );
    await drain(first.updates);

    const second = runner.run(
      { identity: ID_A, includeActivity: false, message: "second", sessionId: "s1" },
      new AbortController().signal,
    );
    await drain(second.updates);

    const messages = agent.recordedMessages[1];
    expect(messages?.map((m) => m.content)).toContain("first");
    expect(messages?.map((m) => m.content)).toContain("second");
  });

  it("shares committed records across request runners using one store", async () => {
    const store = new InMemorySessionStore();
    const firstAgent = fakeAgent({ structuredResponse: structuredFromText("first output") });
    const firstRunner = new AgentRequestRunner({
      executor: new InlineAgentExecutor({ agentSource: async () => firstAgent }),
      store,
    });
    const first = firstRunner.run(
      { identity: ID_A, includeActivity: false, message: "first", sessionId: "s1" },
      new AbortController().signal,
    );
    await drain(first.updates);
    await first.result;

    const secondAgent = fakeAgent({ structuredResponse: structuredFromText("second output") });
    const secondRunner = new AgentRequestRunner({
      executor: new InlineAgentExecutor({ agentSource: async () => secondAgent }),
      store,
    });
    const second = secondRunner.run(
      { identity: ID_A, includeActivity: false, message: "second", sessionId: "s1" },
      new AbortController().signal,
    );
    await drain(second.updates);
    await second.result;

    expect(secondAgent.recordedMessages[0]?.map((message) => message.content)).toContain("first");
    expect(store.loadSession(ID_A, "s1")?.structuredOutput).toEqual(
      structuredFromText("second output"),
    );
  });

  it("defaults to InMemorySessionStore", async () => {
    const agent = fakeAgent({ structuredResponse: structuredFromText("ok") });
    const runner = new AgentRequestRunner({
      executor: new InlineAgentExecutor({ agentSource: async () => agent }),
    });
    const first = runner.run(
      { identity: ID_A, includeActivity: false, message: "first", sessionId: "s1" },
      new AbortController().signal,
    );
    await drain(first.updates);
    await first.result;

    const second = runner.run(
      { identity: ID_A, includeActivity: false, message: "second", sessionId: "s1" },
      new AbortController().signal,
    );
    await drain(second.updates);
    await second.result;

    expect(agent.recordedMessages[1]?.map((message) => message.content)).toContain("first");
  });
});

describe("AgentRequestRunner commit semantics", () => {
  it("commits once on success", async () => {
    const agent = fakeAgent({ structuredResponse: structuredFromText("ok") });
    const { store, runner } = makeAgentRequestRunner(agent);
    const handle = runner.run(
      { identity: ID_A, includeActivity: false, message: "hello", sessionId: "s1" },
      new AbortController().signal,
    );
    const result = await handle.result;
    await drain(handle.updates);

    expect(result.outcome).toBe("success");
    expect(store.loadSession(ID_A, "s1")?.history).toEqual([
      { content: "hello", role: "user" },
      { content: JSON.stringify(structuredFromText("ok")), role: "assistant" },
    ]);
    expect(store.loadSession(ID_A, "s1")?.structuredOutput).toEqual(structuredFromText("ok"));
  });

  it("records failure state for an invalid model output", async () => {
    const invalid = { version: 1, updates: [{ type: "error", message: "broken" }] };
    const agent = fakeAgent({ structuredResponse: invalid });
    const { store, runner } = makeAgentRequestRunner(agent);
    const handle = runner.run(
      { identity: ID_A, includeActivity: false, message: "generate", sessionId: "s1" },
      new AbortController().signal,
    );
    const result = await handle.result;
    await drain(handle.updates);

    expect(result.outcome).toBe("failure");
    expect(store.loadSession(ID_A, "s1")?.failure).toMatchObject({ code: "invalid_model_output" });
    expect(store.loadSession(ID_A, "s1")?.structuredOutput).toBeNull();
  });

  it("does not carry rejected fallback text into the next turn's history", async () => {
    const agent = fakeAgent({});
    const { runner } = makeAgentRequestRunner(agent);

    const first = runner.run(
      { identity: ID_A, includeActivity: false, message: "first", sessionId: "s1" },
      new AbortController().signal,
    );
    await drain(first.updates);
    const second = runner.run(
      { identity: ID_A, includeActivity: false, message: "second", sessionId: "s1" },
      new AbortController().signal,
    );
    await drain(second.updates);

    const secondMessages = agent.recordedMessages[1] ?? [];
    const contents = secondMessages.map((m) => m.content);
    expect(contents).toContain("first");
    expect(contents).toContain("second");
    expect(
      contents.some(
        (c) => typeof c === "string" && c.includes("could not render that as an interactive UI"),
      ),
    ).toBe(false);
  });

  it("preserves previous committed state when the agent source throws", async () => {
    const ok = fakeAgent({ structuredResponse: structuredFromText("ok") });
    const store = new InMemorySessionStore();
    const calls = { count: 0 };
    const executor = new InlineAgentExecutor({
      agentSource: async () => {
        calls.count += 1;
        if (calls.count === 1) return ok;
        throw new Error("boom");
      },
    });
    const runner = new AgentRequestRunner({ executor, store });

    const first = runner.run(
      { identity: ID_A, includeActivity: false, message: "first", sessionId: "s1" },
      new AbortController().signal,
    );
    await drain(first.updates);
    const second = runner.run(
      { identity: ID_A, includeActivity: false, message: "second", sessionId: "s1" },
      new AbortController().signal,
    );
    const result = await handleResult(second.result);

    expect(result.outcome).toBe("error");
    const history = store.loadSession(ID_A, "s1")?.history ?? [];
    const contents = history.map((m) => (m as { content?: string }).content);
    expect(contents).toContain("first");
    expect(contents).toContain(JSON.stringify(structuredFromText("ok")));
    expect(contents).not.toContain("second");
  });

  it("preserves previous committed state and resolves cancelled on disconnect", async () => {
    const output = createDeferred<{ messages: never[] }>();
    const agent = fakeAgent({ structuredResponse: structuredFromText("late"), output });
    const store = new InMemorySessionStore();
    store.commitSession(ID_A, "s1", {
      failure: null,
      history: [{ content: "prior", role: "user" }],
      structuredOutput: null,
    });
    const executor = new InlineAgentExecutor({ agentSource: async () => agent });
    const runner = new AgentRequestRunner({ executor, store });

    const controller = new AbortController();
    const handle = runner.run(
      { identity: ID_A, includeActivity: false, message: "more", sessionId: "s1" },
      controller.signal,
    );

    controller.abort();
    const result = await handle.result;

    expect(result.outcome).toBe("cancelled");
    expect(store.loadSession(ID_A, "s1")?.history).toEqual([{ content: "prior", role: "user" }]);
    expect(store.lastRun(ID_A, "s1")?.outcome).toBe("cancelled");
  });
});

async function handleResult(result: Promise<ExecutionResult>): Promise<ExecutionResult> {
  return await result;
}
