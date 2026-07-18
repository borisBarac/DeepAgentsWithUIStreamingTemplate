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
import { createRuntimeScaffold } from "../scaffold/index.ts";
import { createAgentFromRuntimeScaffold, type TwoPhaseDeepAgent } from "./runtime.ts";
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

  override withStructuredOutput(_schema: unknown): never {
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

  it("uses the same supervisor for work and a tool-free structured presentation", async () => {
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
        subagents: [],
      }),
      modelRuntime,
      guardrails: false,
    });

    const result = await agent.invoke({ messages: [new HumanMessage("Return JSON.")] });

    expect(result.structuredResponse).toEqual({
      version: 1,
      updates: [{ type: "message", text: "Presented output" }],
    });
    expect(model.workCalls).toBe(1);
    expect(model.presentationInputs).toHaveLength(1);
    expect(JSON.stringify(model.presentationInputs[0])).toContain("Return one JSON object");
    expect(JSON.stringify(model.presentationInputs[0])).not.toContain("product-generator");
    expect(model.boundOptions).toHaveLength(1);
    expect(model.boundOptions[0]?.response_format).toBeUndefined();
    expect(model.boundOptions[0]?.tool_choice).toBeUndefined();
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
        subagents: [],
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

  it("exposes presentation repair without repeating work", async () => {
    const model = new CapturingChatModel({});
    const modelRuntime = createTestModelRuntime();
    const getModelForRole = modelRuntime.getModelForRole.bind(modelRuntime);
    modelRuntime.getModelForRole = (role) =>
      role === "supervisor" ? (model as never) : getModelForRole(role);
    const agent = createAgentFromRuntimeScaffold({
      factoryName: "createScaffoldedAgent",
      scaffold: createRuntimeScaffold({ generativeUi: {}, memory: [], subagents: [] }),
      modelRuntime,
      guardrails: false,
    });
    const twoPhaseAgent = agent as TwoPhaseDeepAgent;
    const workResult = await twoPhaseAgent.invokeWork({ messages: [new HumanMessage("Do work")] });
    await twoPhaseAgent.present({ messages: [], workResult, repairFeedback: "Fix the root." });

    expect(model.workCalls).toBe(1);
    expect(model.presentationInputs).toHaveLength(1);
  });
});
