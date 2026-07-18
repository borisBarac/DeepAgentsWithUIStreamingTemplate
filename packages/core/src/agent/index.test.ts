import { describe, expect, it } from "bun:test";
import { providerStrategy } from "langchain";
import { z } from "zod";

import { createInMemoryMemoryStore, createUserMemoryNamespace } from "../memory/index.ts";
import type { PromptLoader } from "../prompts/index.ts";
import { createScaffoldedAgent } from "./index.ts";
import { createTestModelRuntime } from "./test-helpers.ts";

const testPromptLoader: PromptLoader = {
  getSupervisorPrompt: () => "custom supervisor prompt",
  getClarifierPrompt: () => "custom clarifier prompt",
  getClarificationTriagePrompt: () => "custom triage prompt",
  getResearcherPrompt: () => "custom researcher prompt",
  getAnalystPrompt: () => "custom analyst prompt",
  getImageDesignerPrompt: () => "custom image designer prompt",
  getReviewAgentPrompt: () => "custom review prompt",
};

const testImageGenerationService = {
  async generate() {
    return { success: true as const, url: "https://example.com/generated.png" };
  },
  async edit() {
    return { success: true as const, url: "https://example.com/edited.png" };
  },
};

function expectSystemPromptToContain(systemPrompt: unknown, text: string): void {
  expect(JSON.stringify(systemPrompt)).toContain(text);
}

describe("createScaffoldedAgent", () => {
  it("returns a scaffolded deep agent instance", () => {
    const agent = createScaffoldedAgent({
      imageGenerationService: testImageGenerationService,
      modelRuntime: createTestModelRuntime(),
    });

    expect(typeof agent.invoke).toBe("function");
  });

  it("loads the scaffold memory files by default", () => {
    const agent = createScaffoldedAgent({
      imageGenerationService: testImageGenerationService,
      modelRuntime: createTestModelRuntime(),
    });

    expect(agent.options.middleware?.map((middleware) => middleware.name)).toContain(
      "MemoryMiddleware",
    );
  });

  it("uses a custom prompt loader for the scaffolded supervisor", () => {
    const agent = createScaffoldedAgent({
      imageGenerationService: testImageGenerationService,
      modelRuntime: createTestModelRuntime(),
      promptLoader: testPromptLoader,
    });

    expectSystemPromptToContain(agent.options.systemPrompt, "custom supervisor prompt");
  });

  it("lets an explicit scaffolded system prompt win over the prompt loader", () => {
    const agent = createScaffoldedAgent({
      imageGenerationService: testImageGenerationService,
      modelRuntime: createTestModelRuntime(),
      promptLoader: testPromptLoader,
      systemPrompt: "explicit supervisor prompt",
    });

    expectSystemPromptToContain(agent.options.systemPrompt, "explicit supervisor prompt");
  });

  it("uses the supervisor role model", () => {
    const modelRuntime = createTestModelRuntime();
    const agent = createScaffoldedAgent({
      guardrails: false,
      imageGenerationService: testImageGenerationService,
      modelRuntime,
    });

    expect((agent.options.model as { model?: string }).model).toBe("pro-model");
  });

  it("uses the agent store for the default memory backend", async () => {
    const store = createInMemoryMemoryStore();
    const agent = createScaffoldedAgent({
      guardrails: false,
      imageGenerationService: testImageGenerationService,
      memoryUserId: "alice@example.com",
      modelRuntime: createTestModelRuntime(),
      store,
    });

    await writeAgentMemory(agent, "/memory/project-facts.md", "Agent memory");

    expect(
      (await store.search(createUserMemoryNamespace("alice@example.com"))).map(
        (item) => item.value.content,
      ),
    ).toEqual(["Agent memory"]);
  });

  it("lets backendOptions.memoryStore override the agent store", async () => {
    const agentStore = createInMemoryMemoryStore();
    const memoryStore = createInMemoryMemoryStore();
    const agent = createScaffoldedAgent({
      backendOptions: { memoryStore },
      guardrails: false,
      imageGenerationService: testImageGenerationService,
      memoryUserId: "u1",
      modelRuntime: createTestModelRuntime(),
      store: agentStore,
    });

    await writeAgentMemory(agent, "/memory/project-facts.md", "Overridden memory store");

    expect(
      (await memoryStore.search(createUserMemoryNamespace("u1"))).map((item) => item.value.content),
    ).toEqual(["Overridden memory store"]);
    expect(await agentStore.search(createUserMemoryNamespace("u1"))).toEqual([]);
  });

  it("creates the default scaffold without an image designer when image generation is not configured", () => {
    const agent = createScaffoldedAgent({
      modelRuntime: createTestModelRuntime(),
    });

    expect(typeof agent.invoke).toBe("function");
  });

  it("keeps generative UI catalog instructions out of the work prompt", () => {
    const agent = createScaffoldedAgent({
      modelRuntime: createTestModelRuntime(),
      promptLoader: testPromptLoader,
      imageGenerationService: testImageGenerationService,
      generativeUi: { catalogPrompt: "APP CATALOG" },
    });

    expectSystemPromptToContain(agent.options.systemPrompt, "custom supervisor prompt");
    expect(JSON.stringify(agent.options.systemPrompt)).not.toContain("product-card");
    expect(JSON.stringify(agent.options.systemPrompt)).not.toContain("APP CATALOG");
  });

  it("rejects a custom response format when generative UI owns the contract", () => {
    expect(() =>
      createScaffoldedAgent({
        modelRuntime: createTestModelRuntime(),
        generativeUi: {},
        responseFormat: providerStrategy(z.object({ answer: z.string() })),
      }),
    ).toThrow("cannot combine generativeUi with a custom responseFormat");
  });
});

async function writeAgentMemory(
  agent: ReturnType<typeof createScaffoldedAgent>,
  path: string,
  content: string,
): Promise<void> {
  const middleware = agent.options.middleware?.find(
    (entry) => entry.name === "FilesystemMiddleware",
  );
  const writeTool = middleware?.tools?.find((tool) => tool.name === "write_file") as
    | { invoke: (input: { file_path: string; content: string }) => Promise<unknown> }
    | undefined;

  if (!writeTool) {
    throw new Error("write_file tool was not registered on the scaffolded agent.");
  }

  await writeTool.invoke({ file_path: path, content });
}
