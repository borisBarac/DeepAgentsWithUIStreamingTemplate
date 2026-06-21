import { describe, expect, it } from "bun:test";

import {
  createInMemoryMemoryStore,
  createMemoryRepository,
  createScaffoldedAgent,
  DEFAULT_PROJECT_FACTS_PATH,
  DEFAULT_USER_PREFERENCES_PATH,
} from "../src/index.ts";
import {
  type AgentInvokeResult,
  createDefaultModelRuntime,
  hasLiveLLMCredentials,
} from "./helpers.ts";

const MEMORY_USER_ID = "e2e-memory-user";
const RECALL_MARKER = "PINEAPPLE";
const RECALL_PROMPT = "Say hello and tell me what 2+2 is.";
const RECALL_PREFERENCE = `# User Preferences\n\nAlways begin every reply with the word ${RECALL_MARKER}.\n`;
const PERSIST_PROMPT = "Please remember that this project's build command is `bun run build`.";
const PERSIST_NEEDLE = "bun run build";
const PROJECT_FACTS_SEED = "# Project Facts\n\n## Facts\n\n";

function lastAssistantText(messages: unknown[] | undefined): string {
  if (!messages) return "";
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as { role?: string; content?: unknown } | undefined;
    if (message?.role !== "assistant") continue;
    const content = message?.content;
    return typeof content === "string" ? content : JSON.stringify(content ?? "");
  }
  return "";
}

describe.skipIf(!hasLiveLLMCredentials)("scaffolded agent live memory e2e", () => {
  it("applies a seeded user preference pulled from the memory store", async () => {
    const store = createInMemoryMemoryStore();
    const repo = createMemoryRepository({ store, userId: MEMORY_USER_ID });
    await repo.upsert(DEFAULT_USER_PREFERENCES_PATH, RECALL_PREFERENCE);

    const modelRuntime = createDefaultModelRuntime(false);
    const agent = createScaffoldedAgent({
      modelRuntime,
      guardrails: false,
      store,
      memoryUserId: MEMORY_USER_ID,
    });

    const result = (await agent.invoke({
      messages: [{ role: "user", content: RECALL_PROMPT }],
    })) as AgentInvokeResult;

    expect(lastAssistantText(result.messages)).toContain(RECALL_MARKER);
  }, 60_000);

  it("persists an explicit project fact back into the memory store", async () => {
    const store = createInMemoryMemoryStore();
    const repo = createMemoryRepository({ store, userId: MEMORY_USER_ID });
    await repo.upsert(DEFAULT_PROJECT_FACTS_PATH, PROJECT_FACTS_SEED);

    const modelRuntime = createDefaultModelRuntime(false);
    const agent = createScaffoldedAgent({
      modelRuntime,
      guardrails: false,
      store,
      memoryUserId: MEMORY_USER_ID,
    });

    (await agent.invoke({
      messages: [{ role: "user", content: PERSIST_PROMPT }],
    })) as AgentInvokeResult;

    const persisted = await repo.read(DEFAULT_PROJECT_FACTS_PATH);
    expect(persisted).toContain(PERSIST_NEEDLE);
  }, 60_000);
});
