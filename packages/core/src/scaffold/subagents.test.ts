import { describe, expect, it } from "bun:test";
import type { SubAgent } from "deepagents";

import { clarificationResultSchema } from "../clarification/index.ts";
import { IMAGE_DESIGNER_TOOL_NAME, imageDesignerResponseSchema } from "../image-designer/index.ts";
import { createModelRuntime } from "../models/index.ts";
import type { PromptLoader } from "../prompts/index.ts";
import { reviewReportSchema } from "../review/index.ts";
import { createDefaultSubagents } from "./subagents.ts";

const testPromptLoader: PromptLoader = {
  getBaselinePrompt: () => "baseline prompt",
  getSupervisorPrompt: () => "supervisor prompt",
  getClarifierPrompt: () => "custom clarifier prompt",
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
      [],
      [],
      [IMAGE_DESIGNER_TOOL_NAME],
      [],
    ]);
    expect(subagents.map((subagent) => subagent.skills)).toEqual([[], [], [], [], []]);
    expect(subagents.every((subagent) => subagent.interruptOn === undefined)).toBe(true);
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
      models: {
        primary: { connection: "default", model: "primary-model" },
        fast: { connection: "default", model: "fast-model" },
      },
      assignments: {
        default: "primary",
        clarifier: "fast",
        analyst: "fast",
        "image-designer": "fast",
      },
    });
    const explicitReviewerModel = runtime.getModel("fast");
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
});
