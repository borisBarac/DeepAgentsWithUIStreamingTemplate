import { describe, expect, it } from "bun:test";
import type { SandboxBackend } from "@deep-agent-template/sandbox";
import {
  BaseChatModel,
  type BaseChatModelCallOptions,
  type BindToolsInput,
} from "@langchain/core/language_models/chat_models";
import { AIMessage, type BaseMessage, HumanMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";
import { tool } from "@langchain/core/tools";
import type { SubAgent } from "deepagents";
import {
  type AgentMiddleware,
  createAgent,
  ProviderStrategy,
  StructuredOutputParsingError,
} from "langchain";
import { z } from "zod";

import { IMAGE_DESIGNER_TOOL_NAME } from "../image-designer/index.ts";
import { createModelRuntime } from "../models/index.ts";
import type { PromptLoader } from "../prompts/index.ts";
import { reviewReportSchema } from "../review/index.ts";
import { CLARIFY_DEEPLY_SKILL_DIR } from "../skills/index.ts";
import { createDefaultSubagentCatalog } from "./subagents.ts";

function responseFormatSchema(rf: unknown): unknown {
  return rf != null && typeof rf === "object" && "schema" in rf
    ? (rf as { schema: unknown }).schema
    : rf;
}

function expectProviderStrategy(responseFormat: unknown, requiredProperty: string): void {
  expect(responseFormat).toBeInstanceOf(ProviderStrategy);
  expect(responseFormatSchema(responseFormat)).toMatchObject({
    type: "object",
    properties: { [requiredProperty]: expect.any(Object) },
  });
}

function structuredMiddleware(subagent: SubAgent | undefined): AgentMiddleware {
  const middleware = subagent?.middleware?.at(-1);
  if (!middleware?.wrapModelCall) {
    throw new Error("Expected structured JSON model-call middleware.");
  }
  return middleware;
}

class CapturingChatModel extends BaseChatModel {
  readonly boundOptions: Array<Record<string, unknown>> = [];
  readonly messageCalls: BaseMessage[][] = [];

  constructor(private readonly responses: AIMessage[]) {
    super({});
  }

  _llmType(): string {
    return "capturing-test-model";
  }

  override bindTools(_tools: BindToolsInput[], kwargs?: Partial<BaseChatModelCallOptions>): this {
    this.boundOptions.push((kwargs ?? {}) as Record<string, unknown>);
    return this;
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    this.messageCalls.push(messages);
    const response = this.responses[this.messageCalls.length - 1];
    if (!response) throw new Error("No captured test response configured.");
    return { generations: [{ text: response.text, message: response }] };
  }
}

const testPromptLoader: PromptLoader = {
  getSupervisorPrompt: () => "supervisor prompt",
  getClarifierPrompt: () => "custom clarifier prompt",
  getResearcherPrompt: () => "custom researcher prompt",
  getAnalystPrompt: () => "custom analyst prompt",
  getImageDesignerPrompt: () => "custom image designer prompt",
  getProductGeneratorPrompt: () => "custom product generator prompt",
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

function asDefaultSubagents(catalog: ReturnType<typeof createDefaultSubagentCatalog>): SubAgent[] {
  return catalog.all as SubAgent[];
}

function expectStructuredPrompt(prompt: unknown, basePrompt: string): void {
  expect(prompt).toBe(
    `${basePrompt}\n\nRespond with a single JSON object matching the requested schema.`,
  );
}

describe("default subagents", () => {
  it("omits the image designer when image generation is not configured", () => {
    const catalog = createDefaultSubagentCatalog();
    const subagents = asDefaultSubagents(catalog);

    expect(subagents.map((subagent) => subagent.name)).toEqual([
      "clarifier",
      "researcher",
      "analyst",
      "review-agent",
    ]);
    expect(catalog.byRole["image-designer"]).toBeUndefined();
    expect(catalog.byRole["product-generator"]).toBeUndefined();
    expect(catalog.byRole.clarifier?.name).toBe("clarifier");
    expect(catalog.byRole.reviewer?.name).toBe("review-agent");
  });

  it("provides specialist subagents for clarification, research, analysis, image design, and review", () => {
    const subagents = asDefaultSubagents(
      createDefaultSubagentCatalog({ imageGenerationService: testImageGenerationService }),
    );

    expect(subagents.map((subagent) => subagent.name)).toEqual([
      "clarifier",
      "researcher",
      "analyst",
      "image-designer",
      "review-agent",
    ]);
    expect(subagents.map((subagent) => subagent.tools?.map((tool) => tool.name) ?? [])).toEqual([
      [],
      ["execute_python"],
      ["execute_python"],
      [IMAGE_DESIGNER_TOOL_NAME],
      [],
    ]);
    expect(subagents.map((subagent) => subagent.skills)).toEqual([
      [CLARIFY_DEEPLY_SKILL_DIR],
      [],
      [],
      [],
      [],
    ]);
    expect(subagents.every((subagent) => subagent.interruptOn === undefined)).toBe(true);
  });

  it("shares the configured Python sandbox tool between researcher and analyst", () => {
    const backend: SandboxBackend = {
      name: "test",
      capabilities: {
        isolation: "none",
        supportsArtifacts: false,
        supportsAbort: false,
      },
      async execute() {
        throw new Error("not invoked");
      },
    };
    const [, researcher, analyst] = asDefaultSubagents(
      createDefaultSubagentCatalog({ pythonSandboxBackend: backend }),
    );

    expect(researcher?.tools?.map((tool) => tool.name)).toEqual(["execute_python"]);
    expect(analyst?.tools?.map((tool) => tool.name)).toEqual(["execute_python"]);
    expect(researcher?.tools?.[0]).toBe(analyst?.tools?.[0]);
  });

  it("adds external research tools without removing Python execution", () => {
    const scrapeTool = tool(async ({ url }) => url, {
      name: "scrape",
      description: "Scrape a URL.",
      schema: z.object({ url: z.string().url() }),
    });
    const [, researcher, analyst] = asDefaultSubagents(
      createDefaultSubagentCatalog({ additionalResearcherTools: [scrapeTool] }),
    );

    expect(researcher?.tools?.map((researcherTool) => researcherTool.name)).toEqual([
      "execute_python",
      "scrape",
    ]);
    expect(analyst?.tools?.map((analystTool) => analystTool.name)).toEqual(["execute_python"]);
  });

  it("lets explicit specialist tool overrides replace Python execution", () => {
    const [, researcher, analyst] = asDefaultSubagents(
      createDefaultSubagentCatalog({
        researcher: { tools: [] },
        analyst: { tools: [] },
      }),
    );

    expect(researcher?.tools).toEqual([]);
    expect(analyst?.tools).toEqual([]);
  });

  it("uses a custom prompt loader for default subagent prompts", () => {
    const subagents = asDefaultSubagents(
      createDefaultSubagentCatalog(
        { imageGenerationService: testImageGenerationService },
        {},
        testPromptLoader,
      ),
    );

    expectStructuredPrompt(subagents[0]?.systemPrompt, "custom clarifier prompt");
    expect(subagents[1]?.systemPrompt).toBe("custom researcher prompt");
    expect(subagents[2]?.systemPrompt).toBe("custom analyst prompt");
    expectStructuredPrompt(subagents[3]?.systemPrompt, "custom image designer prompt");
    expectStructuredPrompt(subagents[4]?.systemPrompt, "custom review prompt");
  });

  it("lets explicit subagent prompt overrides win over the prompt loader", () => {
    const [clarifier] = asDefaultSubagents(
      createDefaultSubagentCatalog(
        {
          imageGenerationService: testImageGenerationService,
          clarifier: {
            systemPrompt: "explicit clarifier prompt",
          },
        },
        {},
        testPromptLoader,
      ),
    );

    expect(clarifier?.systemPrompt).toBe("explicit clarifier prompt");
  });

  it("enforces structured output on the clarifier and review agent", () => {
    const [clarifier, researcher, analyst, imageDesigner, reviewer] = asDefaultSubagents(
      createDefaultSubagentCatalog({ imageGenerationService: testImageGenerationService }),
    );

    expectProviderStrategy(clarifier?.responseFormat, "status");
    expect(researcher?.responseFormat).toBeUndefined();
    expect(analyst?.responseFormat).toBeUndefined();
    expectProviderStrategy(imageDesigner?.responseFormat, "designedPrompt");
    expectProviderStrategy(reviewer?.responseFormat, "status");
  });

  it("appends scaffold middleware after caller middleware", () => {
    const callerMiddleware: AgentMiddleware = { name: "caller" };
    const clarifier = createDefaultSubagentCatalog({
      clarifier: { middleware: [callerMiddleware] },
    }).byRole.clarifier;

    expect(clarifier?.middleware?.map((middleware) => middleware.name)).toEqual([
      "caller",
      "ScaffoldStructuredJsonObject",
    ]);
  });

  it("lets an explicit reviewer responseFormat override the default schema", () => {
    const customSchema = reviewReportSchema;
    const [, , , , reviewer] = asDefaultSubagents(
      createDefaultSubagentCatalog({
        imageGenerationService: testImageGenerationService,
        reviewer: {
          responseFormat: customSchema,
        },
      }),
    );

    expect(reviewer?.responseFormat).toBe(customSchema);
    expect(reviewer?.middleware).toBeUndefined();
  });

  it("retains caller middleware when explicit responseFormat opts out", () => {
    const callerMiddleware: AgentMiddleware = { name: "caller" };
    const reviewer = createDefaultSubagentCatalog({
      reviewer: {
        responseFormat: reviewReportSchema,
        middleware: [callerMiddleware],
      },
    }).byRole.reviewer;

    expect(reviewer?.responseFormat).toBe(reviewReportSchema);
    expect(reviewer?.middleware).toEqual([callerMiddleware]);
  });

  it("forces json_object wire settings while preserving existing model settings", async () => {
    const clarifier = createDefaultSubagentCatalog().byRole.clarifier;
    const middleware = structuredMiddleware(clarifier);
    const calls: Array<Record<string, unknown>> = [];
    const request = {
      messages: [new HumanMessage("original")],
      modelSettings: { temperature: 0.2 },
    };

    await middleware.wrapModelCall?.(request as never, async (captured) => {
      calls.push(captured as unknown as Record<string, unknown>);
      return new AIMessage('{"status":"ready_to_proceed"}');
    });

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

  it("retries one parsing failure with transient correction context", async () => {
    const clarifier = createDefaultSubagentCatalog().byRole.clarifier;
    const middleware = structuredMiddleware(clarifier);
    const originalMessages = [new HumanMessage("original")];
    const capturedMessages: unknown[][] = [];
    let calls = 0;

    const result = await middleware.wrapModelCall?.(
      { messages: originalMessages } as never,
      async (request) => {
        calls += 1;
        capturedMessages.push(request.messages);
        if (calls === 1) {
          throw new StructuredOutputParsingError("providerStrategy", ["invalid"]);
        }
        return new AIMessage('{"status":"ready_to_proceed"}');
      },
    );

    expect(result).toBeInstanceOf(AIMessage);
    expect(calls).toBe(2);
    expect(capturedMessages[0]).toEqual(originalMessages);
    expect(capturedMessages[1]).toHaveLength(2);
    expect((capturedMessages[1]?.[1] as HumanMessage).text).toContain("corrected JSON object");
    expect((capturedMessages[1]?.[1] as HumanMessage).text).toContain('"status"');
    expect(originalMessages).toHaveLength(1);
  });

  it("parses valid JSON into structuredResponse after one real agent retry", async () => {
    const payload = {
      status: "ready_to_proceed",
      readyToProceed: true,
      questions: [],
      missingInformation: [],
      answeredInformation: [],
      reasoningSummary: "Enough information is available.",
      roundCount: 1,
      maxRounds: 10,
    };
    const model = new CapturingChatModel([
      new AIMessage("not json"),
      new AIMessage(JSON.stringify(payload)),
    ]);
    const clarifier = createDefaultSubagentCatalog().byRole.clarifier;
    const agent = createAgent({
      model,
      middleware: clarifier?.middleware,
      responseFormat: clarifier?.responseFormat as ProviderStrategy<Record<string, unknown>>,
    });

    const result = await agent.invoke({ messages: [new HumanMessage("Assess readiness.")] });

    expect(result.structuredResponse).toEqual(payload);
    expect(model.messageCalls).toHaveLength(2);
    expect(model.messageCalls[1]?.at(-1)?.text).toContain("corrected JSON object");
    expect(model.boundOptions).toHaveLength(2);
    expect(model.boundOptions[0]?.response_format).toEqual({ type: "json_object" });
    expect(model.boundOptions[0]?.tool_choice).toBeUndefined();
    expect(JSON.stringify(model.boundOptions)).not.toContain("json_schema");
  });

  it("makes only two calls when both structured outputs are invalid", async () => {
    const middleware = structuredMiddleware(createDefaultSubagentCatalog().byRole.clarifier);
    let calls = 0;

    await expect(
      middleware.wrapModelCall?.({ messages: [] } as never, async () => {
        calls += 1;
        throw new StructuredOutputParsingError("providerStrategy", ["invalid"]);
      }),
    ).rejects.toBeInstanceOf(StructuredOutputParsingError);
    expect(calls).toBe(2);
  });

  it("retries a parsing failure wrapped by inner middleware", async () => {
    const middleware = structuredMiddleware(createDefaultSubagentCatalog().byRole.clarifier);
    let calls = 0;

    await middleware.wrapModelCall?.({ messages: [] } as never, async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("inner middleware", {
          cause: new StructuredOutputParsingError("providerStrategy", ["invalid"]),
        });
      }
      return new AIMessage("valid");
    });

    expect(calls).toBe(2);
  });

  it("does not retry unrelated model errors", async () => {
    const middleware = structuredMiddleware(createDefaultSubagentCatalog().byRole.clarifier);
    const providerError = new Error("network unavailable");
    let calls = 0;

    await expect(
      middleware.wrapModelCall?.({ messages: [] } as never, async () => {
        calls += 1;
        throw providerError;
      }),
    ).rejects.toBe(providerError);
    expect(calls).toBe(1);
  });

  it("assigns role models to every default specialist and preserves explicit model overrides", () => {
    const runtime = createModelRuntime({
      connections: {
        default: {
          provider: "openai-compatible",
          apiKey: "test-key",
          baseURL: "https://api.openai.com/v1",
        },
      },
      categories: {
        fast: { connection: "default", model: "fast-model" },
        normal: { connection: "default", model: "normal-model" },
        pro: { connection: "default", model: "pro-model" },
      },
      assignments: {
        default: "normal",
        clarifier: "fast",
        analyst: "fast",
        "image-designer": "fast",
      },
    });
    const explicitReviewerModel = runtime.getModelForCategory("fast");
    const [clarifier, researcher, analyst, imageDesigner, reviewer] = asDefaultSubagents(
      createDefaultSubagentCatalog({
        imageGenerationService: testImageGenerationService,
        modelRuntime: runtime,
      }),
    );
    const [, , , , overriddenReviewer] = asDefaultSubagents(
      createDefaultSubagentCatalog({
        imageGenerationService: testImageGenerationService,
        modelRuntime: runtime,
        reviewer: { model: explicitReviewerModel },
      }),
    );

    expect(clarifier?.model).toBe(runtime.getModelForRole("clarifier"));
    expect(researcher?.model).toBe(runtime.getModelForRole("researcher"));
    expect(analyst?.model).toBe(runtime.getModelForRole("analyst"));
    expect(imageDesigner?.model).toBe(runtime.getModelForRole("image-designer"));
    expect(reviewer?.model).toBe(runtime.getModelForRole("reviewer"));
    expect(overriddenReviewer?.model).toBe(explicitReviewerModel);
  });

  it("omits the product generator when generativeUi is not enabled", () => {
    const subagents = asDefaultSubagents(
      createDefaultSubagentCatalog({ imageGenerationService: testImageGenerationService }),
    );

    expect(subagents.map((subagent) => subagent.name)).not.toContain("product-generator");
  });

  it("includes the product generator after the image designer when generativeUi is enabled", () => {
    const subagents = asDefaultSubagents(
      createDefaultSubagentCatalog({
        imageGenerationService: testImageGenerationService,
        generativeUi: {},
      }),
    );

    expect(subagents.map((subagent) => subagent.name)).toEqual([
      "clarifier",
      "researcher",
      "analyst",
      "image-designer",
      "product-generator",
      "review-agent",
    ]);

    const productGenerator = subagents.find((subagent) => subagent.name === "product-generator");
    expectProviderStrategy(productGenerator?.responseFormat, "products");
    expect(productGenerator?.tools?.map((tool) => tool.name)).toEqual([IMAGE_DESIGNER_TOOL_NAME]);
  });

  it("includes the product generator without an image tool when no image service is configured", () => {
    const subagents = asDefaultSubagents(createDefaultSubagentCatalog({ generativeUi: {} }));

    const productGenerator = subagents.find((subagent) => subagent.name === "product-generator");
    expect(productGenerator?.tools).toEqual([]);
  });

  it("uses the prompt loader for the product generator prompt and lets overrides win", () => {
    const defaultSubagents = asDefaultSubagents(
      createDefaultSubagentCatalog({ generativeUi: {} }, {}, testPromptLoader),
    );
    expect(
      defaultSubagents.find((subagent) => subagent.name === "product-generator")?.systemPrompt,
    ).toBe(
      "custom product generator prompt\n\nRespond with a single JSON object matching the requested schema.",
    );

    const overriddenSubagents = asDefaultSubagents(
      createDefaultSubagentCatalog(
        {
          generativeUi: {},
          productGenerator: { systemPrompt: "explicit product generator prompt" },
        },
        {},
        testPromptLoader,
      ),
    );
    expect(
      overriddenSubagents.find((subagent) => subagent.name === "product-generator")?.systemPrompt,
    ).toBe("explicit product generator prompt");
  });
});
