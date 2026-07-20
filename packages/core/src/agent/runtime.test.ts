import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  BaseChatModel,
  type BaseChatModelCallOptions,
  type BindToolsInput,
} from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";
import { DEFAULT_SAFETY_GUARDRAIL_NAME } from "../guardrails/safety.ts";
import { DEFAULT_TASK_SCOPE_GUARDRAIL_NAME } from "../guardrails/task-scope.ts";
import { clearHarnessProfileRegistry } from "../profiles/index.ts";
import { createRuntimeScaffold } from "../scaffold/index.ts";
import { createAgentFromRuntimeScaffold } from "./runtime.ts";
import { createTestModelRuntime } from "./test-helpers.ts";

const langSmithEnvKeys = [
  "LANGSMITH_API_KEY",
  "LANGSMITH_ENDPOINT",
  "LANGSMITH_PROJECT",
  "LANGSMITH_TRACING",
  "LANGSMITH_WORKSPACE_ID",
] as const;

const originalLangSmithEnv = Object.fromEntries(
  langSmithEnvKeys.map((key) => [key, process.env[key]]),
);

class CapturingChatModel extends BaseChatModel {
  readonly boundOptions: Array<Record<string, unknown>> = [];
  readonly presentationInputs: unknown[] = [];
  readonly structuredOutputSchemas: unknown[] = [];
  workCalls = 0;

  _llmType(): string {
    return "capturing-supervisor-model";
  }

  override bindTools(_tools: BindToolsInput[], kwargs?: Partial<BaseChatModelCallOptions>): this {
    this.boundOptions.push((kwargs ?? {}) as Record<string, unknown>);
    return this;
  }

  async _generate(_messages: BaseMessage[]): Promise<ChatResult> {
    this.workCalls += 1;
    const response = new AIMessage("Completed work candidate");
    return { generations: [{ text: response.text, message: response }] };
  }

  override withStructuredOutput(schema: unknown): never {
    this.structuredOutputSchemas.push(schema);
    return {
      invoke: async (input: unknown) => {
        this.presentationInputs.push(input);
        return {
          version: 1,
          updates: [{ type: "message", text: "Presented output" }],
        };
      },
    } as never;
  }
}

beforeEach(() => {
  for (const key of langSmithEnvKeys) {
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of langSmithEnvKeys) {
    const originalValue = originalLangSmithEnv[key];

    if (originalValue === undefined) {
      delete process.env[key];
      continue;
    }

    process.env[key] = originalValue;
  }
  clearHarnessProfileRegistry();
});

describe("createAgentFromRuntimeScaffold", () => {
  it("applies LangSmith options", () => {
    createAgentFromRuntimeScaffold({
      factoryName: "createScaffoldedAgent",
      scaffold: createRuntimeScaffold(),
      modelRuntime: createTestModelRuntime(),
      guardrails: false,
      langSmith: { apiKey: "runtime-langsmith-key", projectName: "runtime-project" },
    });

    expect(process.env.LANGSMITH_API_KEY).toBe("runtime-langsmith-key");
    expect(process.env.LANGSMITH_PROJECT).toBe("runtime-project");
    expect(process.env.LANGSMITH_TRACING).toBe("true");
  });

  it("orders guardrail middleware before caller middleware", () => {
    const callerMiddleware = { name: "CallerMiddleware" };
    const agent = createAgentFromRuntimeScaffold({
      factoryName: "createScaffoldedAgent",
      scaffold: createRuntimeScaffold(),
      modelRuntime: createTestModelRuntime(),
      middleware: [callerMiddleware],
    });
    const names = agent.options.middleware?.map((middleware) => middleware.name) ?? [];

    expect(names).toContain(DEFAULT_SAFETY_GUARDRAIL_NAME);
    expect(names).toContain(DEFAULT_TASK_SCOPE_GUARDRAIL_NAME);
    expect(names).toContain("CallerMiddleware");
    expect(names.indexOf(DEFAULT_SAFETY_GUARDRAIL_NAME)).toBeLessThan(
      names.indexOf(DEFAULT_TASK_SCOPE_GUARDRAIL_NAME),
    );
    expect(names.indexOf(DEFAULT_TASK_SCOPE_GUARDRAIL_NAME)).toBeLessThan(
      names.indexOf("CallerMiddleware"),
    );
  });

  it("disables guardrail middleware while preserving caller middleware", () => {
    const callerMiddleware = { name: "CallerMiddleware" };
    const agent = createAgentFromRuntimeScaffold({
      factoryName: "createScaffoldedAgent",
      scaffold: createRuntimeScaffold(),
      modelRuntime: createTestModelRuntime(),
      guardrails: false,
      middleware: [callerMiddleware],
    });
    const names = agent.options.middleware?.map((middleware) => middleware.name) ?? [];

    expect(names).not.toContain(DEFAULT_SAFETY_GUARDRAIL_NAME);
    expect(names).not.toContain(DEFAULT_TASK_SCOPE_GUARDRAIL_NAME);
    expect(names).toContain("CallerMiddleware");
  });

  it("keeps structured output and JSON middleware off the work agent", () => {
    const agent = createAgentFromRuntimeScaffold({
      factoryName: "createScaffoldedAgent",
      scaffold: createRuntimeScaffold({ generativeUi: {} }),
      modelRuntime: createTestModelRuntime(),
      guardrails: false,
    });
    const responseFormat = agent.options.responseFormat;
    expect(responseFormat).toBeUndefined();
    expect(
      agent.options.middleware?.some((entry) => entry.name === "ScaffoldStructuredJsonObject"),
    ).toBeFalse();
  });

  it("does not invoke withStructuredOutput on the supervisor (no second LLM call)", () => {
    // Contract: with the two-phase presentation adapter removed, the
    // supervisor never calls withStructuredOutput. UI is emitted by pure
    // converters drained from workflow state. Subagents return prose; the
    // work agent neither sets responseFormat nor calls withStructuredOutput.
    const model = new CapturingChatModel({});
    const modelRuntime = createTestModelRuntime();
    const getModelForRole = modelRuntime.getModelForRole.bind(modelRuntime);
    modelRuntime.getModelForRole = (role) =>
      role === "supervisor" ? (model as never) : getModelForRole(role);
    createAgentFromRuntimeScaffold({
      factoryName: "createScaffoldedAgent",
      scaffold: createRuntimeScaffold({
        generativeUi: {},
        memory: [],
        modelRuntime,
        subagents: [
          { name: "clarifier", description: "c", systemPrompt: "c" },
          { name: "review-agent", description: "r", systemPrompt: "r" },
          { name: "product-generator", description: "p", systemPrompt: "p" },
        ],
      }),
      modelRuntime,
      guardrails: false,
    });

    expect(model.structuredOutputSchemas).toHaveLength(0);
    expect(model.presentationInputs).toHaveLength(0);
  });

  it("preserves LangGraph stream private field access", async () => {
    const model = new CapturingChatModel({});
    const modelRuntime = createTestModelRuntime();
    const getModelForRole = modelRuntime.getModelForRole.bind(modelRuntime);
    modelRuntime.getModelForRole = (role) =>
      role === "supervisor" ? (model as never) : getModelForRole(role);
    const agent = createAgentFromRuntimeScaffold({
      factoryName: "createScaffoldedAgent",
      scaffold: createRuntimeScaffold({
        generativeUi: {},
        memory: [],
        modelRuntime,
        subagents: [
          { name: "clarifier", description: "c", systemPrompt: "c" },
          { name: "review-agent", description: "r", systemPrompt: "r" },
          { name: "product-generator", description: "p", systemPrompt: "p" },
        ],
      }),
      modelRuntime,
      guardrails: false,
    });

    const run = await agent.streamEvents(
      { messages: [new HumanMessage("Return JSON.")] },
      { version: "v3" },
    );

    expect(() => run.messages).not.toThrow();
    expect(() => run[Symbol.asyncIterator]()).not.toThrow();
  });

  it("auto-adds the general-purpose subagent to the task tool's available list", () => {
    // Regression: deepagents silently unshifts a general-purpose subagent into
    // the inline subagents array unless the harness profile disables it. This
    // repo ships a custom GP prompt via DEFAULT_AGENT_PROFILE, so GP stays
    // enabled. The supervisor must see `general-purpose` as a valid delegate
    // target — the only signal is the `task` tool's description, which lists
    // the available subagent names comma-separated after "Available:".
    const agent = createAgentFromRuntimeScaffold({
      factoryName: "createScaffoldedAgent",
      scaffold: createRuntimeScaffold(),
      modelRuntime: createTestModelRuntime(),
      guardrails: false,
    });
    const subAgentMiddleware = agent.options?.middleware?.find(
      (entry) => entry.name === "subAgentMiddleware",
    );
    const taskTool = subAgentMiddleware?.tools?.find(
      (entry: { name?: string }) => entry.name === "task",
    ) as { description?: string } | undefined;
    expect(taskTool?.description).toMatch(/Available.*\bgeneral-purpose\b/s);
  });

  it("registers a caller-supplied harness profile under the bare openai key", () => {
    // The caller's profile overrides must land in deepagents' registry under
    // the bare "openai" key, since getModelIdentifier returns undefined for
    // our ChatOpenAI instances (only `model` is set, not model_name/modelName).
    createAgentFromRuntimeScaffold({
      factoryName: "createScaffoldedAgent",
      scaffold: createRuntimeScaffold(),
      modelRuntime: createTestModelRuntime(),
      guardrails: false,
      profile: { systemPromptSuffix: "CALLER_PROFILE_MARKER_XYZ" },
    });
    const registry = (globalThis as Record<symbol, { profiles: Map<string, unknown> } | undefined>)[
      Symbol.for("deepagents.harness-profiles.v1")
    ];
    const raw = registry?.profiles?.get("openai") as { systemPromptSuffix?: string } | undefined;
    expect(raw?.systemPromptSuffix).toMatch(/CALLER_PROFILE_MARKER_XYZ/);
  });
});
