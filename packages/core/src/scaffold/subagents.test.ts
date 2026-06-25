import { describe, expect, it } from "bun:test";
import type { SandboxBackend } from "@deep-agent-template/sandbox";
import { tool } from "@langchain/core/tools";
import type { SubAgent } from "deepagents";
import { z } from "zod";

import { clarificationResultSchema } from "../clarification/index.ts";
import { productCardBatchSchema } from "../generative-ui/index.ts";
import { IMAGE_DESIGNER_TOOL_NAME, imageDesignerResponseSchema } from "../image-designer/index.ts";
import { createModelRuntime } from "../models/index.ts";
import type { PromptLoader } from "../prompts/index.ts";
import { reviewReportSchema } from "../review/index.ts";
import { CLARIFY_DEEPLY_SKILL_DIR } from "../skills/index.ts";
import { createDefaultSubagents } from "./subagents.ts";

const testPromptLoader: PromptLoader = {
  getBaselinePrompt: () => "baseline prompt",
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

function asDefaultSubagents(subagents: unknown): SubAgent[] {
  return subagents as SubAgent[];
}

describe("default subagents", () => {
  it("omits the image designer when image generation is not configured", () => {
    const subagents = asDefaultSubagents(createDefaultSubagents());

    expect(subagents.map((subagent) => subagent.name)).toEqual([
      "clarifier",
      "researcher",
      "analyst",
      "review-agent",
    ]);
  });

  it("provides specialist subagents for clarification, research, analysis, image design, and review", () => {
    const subagents = asDefaultSubagents(
      createDefaultSubagents({ imageGenerationService: testImageGenerationService }),
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
      createDefaultSubagents({ pythonSandboxBackend: backend }),
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
      createDefaultSubagents({ additionalResearcherTools: [scrapeTool] }),
    );

    expect(researcher?.tools?.map((researcherTool) => researcherTool.name)).toEqual([
      "execute_python",
      "scrape",
    ]);
    expect(analyst?.tools?.map((analystTool) => analystTool.name)).toEqual(["execute_python"]);
  });

  it("lets explicit specialist tool overrides replace Python execution", () => {
    const [, researcher, analyst] = asDefaultSubagents(
      createDefaultSubagents({
        researcher: { tools: [] },
        analyst: { tools: [] },
      }),
    );

    expect(researcher?.tools).toEqual([]);
    expect(analyst?.tools).toEqual([]);
  });

  it("uses a custom prompt loader for default subagent prompts", () => {
    const subagents = asDefaultSubagents(
      createDefaultSubagents(
        { imageGenerationService: testImageGenerationService },
        {},
        testPromptLoader,
      ),
    );

    expect(subagents.map((subagent) => subagent.systemPrompt)).toEqual([
      "custom clarifier prompt",
      "custom researcher prompt",
      "custom analyst prompt",
      "custom image designer prompt",
      "custom review prompt",
    ]);
  });

  it("lets explicit subagent prompt overrides win over the prompt loader", () => {
    const [clarifier] = asDefaultSubagents(
      createDefaultSubagents(
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
      createDefaultSubagents({ imageGenerationService: testImageGenerationService }),
    );

    expect(clarifier?.responseFormat).toBe(clarificationResultSchema);
    expect(researcher?.responseFormat).toBeUndefined();
    expect(analyst?.responseFormat).toBeUndefined();
    expect(imageDesigner?.responseFormat).toBe(imageDesignerResponseSchema);
    expect(reviewer?.responseFormat).toBe(reviewReportSchema);
  });

  it("lets an explicit reviewer responseFormat override the default schema", () => {
    const customSchema = reviewReportSchema;
    const [, , , , reviewer] = createDefaultSubagents({
      imageGenerationService: testImageGenerationService,
      reviewer: {
        responseFormat: customSchema,
      },
    }) as SubAgent[];

    expect(reviewer?.responseFormat).toBe(customSchema);
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
      createDefaultSubagents({
        imageGenerationService: testImageGenerationService,
        modelRuntime: runtime,
      }),
    );
    const [, , , , overriddenReviewer] = asDefaultSubagents(
      createDefaultSubagents({
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
      createDefaultSubagents({ imageGenerationService: testImageGenerationService }),
    );

    expect(subagents.map((subagent) => subagent.name)).not.toContain("product-generator");
  });

  it("includes the product generator after the image designer when generativeUi is enabled", () => {
    const subagents = asDefaultSubagents(
      createDefaultSubagents({
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
    expect(productGenerator?.responseFormat).toBe(productCardBatchSchema);
    expect(productGenerator?.tools?.map((tool) => tool.name)).toEqual([IMAGE_DESIGNER_TOOL_NAME]);
  });

  it("includes the product generator without an image tool when no image service is configured", () => {
    const subagents = asDefaultSubagents(createDefaultSubagents({ generativeUi: {} }));

    const productGenerator = subagents.find((subagent) => subagent.name === "product-generator");
    expect(productGenerator?.tools).toEqual([]);
  });

  it("uses the prompt loader for the product generator prompt and lets overrides win", () => {
    const defaultSubagents = asDefaultSubagents(
      createDefaultSubagents({ generativeUi: {} }, {}, testPromptLoader),
    );
    expect(
      defaultSubagents.find((subagent) => subagent.name === "product-generator")?.systemPrompt,
    ).toBe("custom product generator prompt");

    const overriddenSubagents = asDefaultSubagents(
      createDefaultSubagents(
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
