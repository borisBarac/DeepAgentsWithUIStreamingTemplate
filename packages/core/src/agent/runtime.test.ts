import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  BaseChatModel,
  type BaseChatModelCallOptions,
  type BindToolsInput,
} from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";
import { ProviderStrategy, StructuredOutputParsingError } from "langchain";
import { DEFAULT_SAFETY_GUARDRAIL_NAME } from "../guardrails/safety.ts";
import { DEFAULT_TASK_SCOPE_GUARDRAIL_NAME } from "../guardrails/task-scope.ts";
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

  _llmType(): string {
    return "capturing-supervisor-model";
  }

  override bindTools(_tools: BindToolsInput[], kwargs?: Partial<BaseChatModelCallOptions>): this {
    this.boundOptions.push((kwargs ?? {}) as Record<string, unknown>);
    return this;
  }

  async _generate(_messages: BaseMessage[]): Promise<ChatResult> {
    const response = new AIMessage(
      '{"version":1,"updates":[{"type":"message","text":"Bound JSON output"}]}',
    );
    return { generations: [{ text: response.text, message: response }] };
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

  it("enforces the generative UI response format through JSON object mode", async () => {
    const agent = createAgentFromRuntimeScaffold({
      factoryName: "createScaffoldedAgent",
      scaffold: createRuntimeScaffold({ generativeUi: {} }),
      modelRuntime: createTestModelRuntime(),
      guardrails: false,
    });
    const responseFormat = agent.options.responseFormat;
    const middleware = agent.options.middleware?.find(
      (entry) => entry.name === "ScaffoldStructuredJsonObject",
    );
    const calls: Array<Record<string, unknown>> = [];

    expect(responseFormat).toBeInstanceOf(ProviderStrategy);
    expect((responseFormat as ProviderStrategy).schema).toMatchObject({
      type: "object",
      properties: {
        version: { const: 1 },
        updates: { type: "array" },
      },
    });
    expect(middleware?.wrapModelCall).toBeFunction();

    await middleware?.wrapModelCall?.(
      {
        messages: [new HumanMessage("Return JSON.")],
        modelSettings: {
          temperature: 0.2,
          outputConfig: { schema: "forbidden" },
          responseSchema: { type: "object" },
          ls_structured_output_format: { schema: "forbidden" },
          strict: true,
        },
      } as never,
      async (request) => {
        calls.push(request as unknown as Record<string, unknown>);
        return new AIMessage('{"version":1,"updates":[{"type":"message","text":"ok"}]}');
      },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.modelSettings).toEqual({
      temperature: 0.2,
      response_format: { type: "json_object" },
      outputConfig: undefined,
      responseSchema: undefined,
      ls_structured_output_format: undefined,
      strict: undefined,
    });
    expect(calls[0]?.toolChoice).toBeUndefined();
    expect(JSON.stringify(calls[0])).not.toContain("json_schema");
  });

  it("binds the supervisor with json_object and no schema or forced tool choice", async () => {
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
      updates: [{ type: "message", text: "Bound JSON output" }],
    });
    expect(model.boundOptions).toHaveLength(1);
    expect(model.boundOptions[0]?.response_format).toEqual({ type: "json_object" });
    expect(model.boundOptions[0]?.tool_choice).toBeUndefined();
    expect(JSON.stringify(model.boundOptions)).not.toContain("json_schema");
  });

  it("leaves supervisor parse retries to the interaction processor", async () => {
    const agent = createAgentFromRuntimeScaffold({
      factoryName: "createScaffoldedAgent",
      scaffold: createRuntimeScaffold({ generativeUi: {} }),
      modelRuntime: createTestModelRuntime(),
      guardrails: false,
    });
    const middleware = agent.options.middleware?.find(
      (entry) => entry.name === "ScaffoldStructuredJsonObject",
    );
    let calls = 0;

    await expect(
      middleware?.wrapModelCall?.({ messages: [] } as never, async () => {
        calls += 1;
        throw new StructuredOutputParsingError("providerStrategy", ["invalid"]);
      }),
    ).rejects.toBeInstanceOf(StructuredOutputParsingError);
    expect(calls).toBe(1);
  });
});
