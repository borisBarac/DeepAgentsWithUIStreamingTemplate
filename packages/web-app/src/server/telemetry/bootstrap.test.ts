import { afterEach, describe, expect, it } from "bun:test";

import type {
  AgentInputMessage,
  StreamableAgent,
  UiUpdate,
} from "@deep-agent-template/core/interaction-stream";
import { InlineAgentExecutor } from "../agent-runtime/executor.ts";
import { AgentRequestRunner } from "../agent-runtime/request-runner.ts";
import { InMemorySessionStore } from "../agent-runtime/store.ts";
import { isTelemetryRegistered, registerTelemetry, shutdownTelemetry } from "./bootstrap.ts";

afterEach(async () => {
  await shutdownTelemetry();
});

function asyncIterableFrom<T>(items: T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}

function fakeAgent(structuredResponse: unknown): StreamableAgent {
  return {
    invoke: async () => ({ messages: [] }),
    async streamEvents(input: { messages: AgentInputMessage[] }) {
      void input;
      return {
        messages: asyncIterableFrom([{ text: asyncIterableFrom([]) }]),
        output: Promise.resolve({ messages: [], structuredResponse }),
      };
    },
  };
}

async function runOnce(): Promise<{ outcome: string; updates: UiUpdate[] }> {
  const store = new InMemorySessionStore();
  const executor = new InlineAgentExecutor({
    agentSource: async () => fakeAgent(undefined),
  });
  const runner = new AgentRequestRunner({ executor, store });
  const handle = runner.run(
    {
      identity: { tenantId: "t", userId: "u" },
      includeActivity: false,
      message: "hi",
      sessionId: "s",
    },
    new AbortController().signal,
  );
  const updates: UiUpdate[] = [];
  for await (const u of handle.updates) updates.push(u);
  return { outcome: (await handle.result).outcome, updates };
}

describe("registerTelemetry", () => {
  it("does not affect execution when configured without an exporter", async () => {
    expect(isTelemetryRegistered()).toBe(false);
    registerTelemetry();
    expect(isTelemetryRegistered()).toBe(true);

    const { outcome } = await runOnce();
    expect(outcome).toBe("success");
  });

  it("registers at most once per process", () => {
    registerTelemetry();
    registerTelemetry();
    expect(isTelemetryRegistered()).toBe(true);
  });
});
