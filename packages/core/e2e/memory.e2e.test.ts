import { describe, expect, it } from "bun:test";
import { createAgentFromRuntimeScaffold } from "../src/agent/runtime.ts";
import {
  createInMemoryMemoryStore,
  createMemoryRepository,
  createRuntimeScaffold,
  DEFAULT_PROJECT_FACTS_PATH,
  DEFAULT_USER_PREFERENCES_PATH,
} from "../src/index.ts";
import {
  type AgentInvokeResult,
  createDefaultModelRuntime,
  hasLiveLLMCredentials,
} from "./helpers.ts";

/**
 * Memory is exercised in isolation: a scaffold with no subagents and NO
 * workflow-controller middleware. The workflow controller is the subject of
 * the delegation/products suites; here we only prove the agent recalls and
 * persists facts through its memory backend.
 */
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
  const modelRuntime = createDefaultModelRuntime(false);
  const scaffold = createRuntimeScaffold({
    backendOptions: { memoryStore: store, memoryUserId: MEMORY_USER_ID },
    modelRuntime,
    subagents: [],
  });
  const agent = createAgentFromRuntimeScaffold({
    factoryName: "createScaffoldedAgent",
    scaffold,
    modelRuntime,
    guardrails: false,
    store,
  });
  return { agent, repo };
}

describe.skipIf(!hasLiveLLMCredentials)("agent memory live e2e", () => {
  it.concurrent("recalls a seeded fact from the memory store", async () => {
    const { agent, repo } = buildMemoryAgent();
    await repo.upsert(DEFAULT_USER_PREFERENCES_PATH, RECALL_SEED);

    const result = (await agent.invoke({
      messages: [{ role: "user", content: RECALL_PROMPT }],
    })) as AgentInvokeResult;

    expect(transcriptOf(result.messages)).toContain(RECALL_NEEDLE);
  }, 90_000);

  it.concurrent("persists an explicit project fact into the memory store", async () => {
    const { agent, repo } = buildMemoryAgent();
    await repo.upsert(DEFAULT_PROJECT_FACTS_PATH, PROJECT_FACTS_SEED);

    await agent.invoke({
      messages: [{ role: "user", content: PERSIST_PROMPT }],
    });

    const persisted = await repo.read(DEFAULT_PROJECT_FACTS_PATH);
    expect(persisted).toContain(PERSIST_NEEDLE);
  }, 90_000);
});
