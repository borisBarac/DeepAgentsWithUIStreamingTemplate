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

const RECALL_NEEDLE = "NEBULA-9";
const RECALL_SEED = `# User Preferences\n\nThe user's reference project codename is ${RECALL_NEEDLE}.\n`;
const RECALL_PROMPT = "What is my reference project codename?";

const PERSIST_PROMPT = "Please remember that this project's build command is `bun run build`.";
const PERSIST_NEEDLE = "bun run build";
const PROJECT_FACTS_SEED = "# Project Facts\n\n## Facts\n\n";

function stringifyMessageContent(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  return JSON.stringify(content ?? "");
}

function transcriptOf(messages: unknown[] | undefined): string {
  return messages?.map(stringifyMessageContent).join("\n") ?? "";
}

function buildMemoryAgent() {
  const store = createInMemoryMemoryStore();
  const repo = createMemoryRepository({ store, userId: MEMORY_USER_ID });
  const agent = createScaffoldedAgent({
    modelRuntime: createDefaultModelRuntime(false),
    guardrails: false,
    store,
    memoryUserId: MEMORY_USER_ID,
  });
  return { agent, repo };
}

describe.skipIf(!hasLiveLLMCredentials)("scaffolded agent live memory e2e", () => {
  it.concurrent("recalls a seeded fact from the memory store", async () => {
    const { agent, repo } = buildMemoryAgent();
    await repo.upsert(DEFAULT_USER_PREFERENCES_PATH, RECALL_SEED);

    const result = (await agent.invoke({
      messages: [{ role: "user", content: RECALL_PROMPT }],
    })) as AgentInvokeResult;

    expect(transcriptOf(result.messages)).toContain(RECALL_NEEDLE);
  }, 60_000);

  it.concurrent("persists an explicit project fact into the memory store", async () => {
    const { agent, repo } = buildMemoryAgent();
    await repo.upsert(DEFAULT_PROJECT_FACTS_PATH, PROJECT_FACTS_SEED);

    (await agent.invoke({
      messages: [{ role: "user", content: PERSIST_PROMPT }],
    })) as AgentInvokeResult;

    const persisted = await repo.read(DEFAULT_PROJECT_FACTS_PATH);
    expect(persisted).toContain(PERSIST_NEEDLE);
  }, 60_000);
});
