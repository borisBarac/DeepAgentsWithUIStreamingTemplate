import { describe, expect, it } from "bun:test";
import { type FilesystemPermission, StateBackend, type SubAgent } from "deepagents";

import { clarificationResultSchema } from "../clarification/index.ts";
import { IMAGE_DESIGNER_TOOL_NAME, imageDesignerResponseSchema } from "../image-designer/index.ts";
import { createModelRuntime } from "../models/index.ts";
import type { PromptLoader } from "../prompts/index.ts";
import { reviewReportSchema } from "../review/index.ts";
import { createRuntimeScaffold } from "./runtime.ts";

function responseFormatSchema(rf: unknown): unknown {
  return rf != null && typeof rf === "object" && "schema" in rf
    ? (rf as { schema: unknown }).schema
    : rf;
}

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

function expectStructuredPrompt(prompt: unknown, basePrompt: string): void {
  expect(prompt).toBe(
    `${basePrompt}\n\nRespond with a single JSON object matching the requested schema.`,
  );
}

describe("runtime scaffold defaults", () => {
  it("creates the default runtime shape", () => {
    const scaffold = createRuntimeScaffold({ imageGenerationService: testImageGenerationService });

    expect(scaffold.architecture).toBe("supervisor-specialists");
    expect(scaffold.memoryFilePaths).toEqual([
      "/memory/project-facts.md",
      "/memory/user-preferences.md",
    ]);
    expect(scaffold.memory).toEqual(["/memory/project-facts.md", "/memory/user-preferences.md"]);
    expect(scaffold.virtualFilesystem.reports).toBe("/reports");
    expect(scaffold.interruptOn).toBeUndefined();
    expect(scaffold.clarification).toEqual({
      requiredSubagent: "clarifier",
      config: {
        enabled: true,
        maxRounds: 2,
        questionsPerRound: 3,
        mode: "mandatory-preflight",
      },
    });
    expect(scaffold.productGeneration).toEqual({ enabled: false });
    expect(scaffold.review).toEqual({ requiredSubagent: "review-agent" });
  });

  it("lets explicit runtime overrides win over defaults", () => {
    const customBackend = new StateBackend();
    const customInterrupts = { execute_python: false };
    const customMemory = ["/memory/custom.md"];
    const customPermissions: FilesystemPermission[] = [
      { operations: ["read"], paths: ["/custom"] },
    ];
    const customSubagents: SubAgent[] = [
      { name: "custom", description: "Custom subagent", systemPrompt: "custom prompt" },
    ];

    const scaffold = createRuntimeScaffold({
      backend: customBackend,
      interruptOn: customInterrupts,
      memory: customMemory,
      permissions: customPermissions,
      subagents: customSubagents,
      systemPrompt: "explicit supervisor prompt",
    });

    expect(scaffold.backend).toBe(customBackend);
    expect(scaffold.interruptOn).toBe(customInterrupts);
    expect(scaffold.memory).toBe(customMemory);
    expect(scaffold.permissions).toBe(customPermissions);
    expect(scaffold.subagents).toBe(customSubagents);
    expect(scaffold.systemPrompt).toBe("explicit supervisor prompt");
  });

  it("applies custom clarification limits to runtime prompts and subagents", () => {
    const scaffold = createRuntimeScaffold({
      imageGenerationService: testImageGenerationService,
      clarificationOptions: {
        maxRounds: 6,
        questionsPerRound: 2,
      },
    });

    expect(scaffold.clarification.config.maxRounds).toBe(6);
    expect(scaffold.clarification.config.questionsPerRound).toBe(2);
    expect(scaffold.systemPrompt).toContain("after 6 rounds");
    expect(JSON.stringify(asDefaultSubagents(scaffold.subagents)[0]?.systemPrompt)).toContain(
      "between 1 and 2 high-value clarification questions per round",
    );
  });

  it("uses a custom prompt loader for default subagent prompts", () => {
    const scaffold = createRuntimeScaffold({
      imageGenerationService: testImageGenerationService,
      promptLoader: testPromptLoader,
    });
    const subagents = asDefaultSubagents(scaffold.subagents);

    expectStructuredPrompt(subagents[0]?.systemPrompt, "custom clarifier prompt");
    expect(subagents[1]?.systemPrompt).toBe("custom researcher prompt");
    expect(subagents[2]?.systemPrompt).toBe("custom analyst prompt");
    expectStructuredPrompt(subagents[3]?.systemPrompt, "custom image designer prompt");
    expectStructuredPrompt(subagents[4]?.systemPrompt, "custom review prompt");
    expect(scaffold.systemPrompt).toBe("supervisor prompt");
  });

  it("lets explicit subagent prompt overrides win over the prompt loader", () => {
    const [clarifier] = asDefaultSubagents(
      createRuntimeScaffold({
        imageGenerationService: testImageGenerationService,
        promptLoader: testPromptLoader,
        clarifier: {
          systemPrompt: "explicit clarifier prompt",
        },
      }).subagents,
    );

    expect(clarifier?.systemPrompt).toBe("explicit clarifier prompt");
  });

  it("enforces structured output on the clarifier and review agent", () => {
    const [clarifier, researcher, analyst, imageDesigner, reviewer] = asDefaultSubagents(
      createRuntimeScaffold({ imageGenerationService: testImageGenerationService }).subagents,
    );

    expect(responseFormatSchema(clarifier?.responseFormat)).toBe(clarificationResultSchema);
    expect(researcher?.responseFormat).toBeUndefined();
    expect(analyst?.responseFormat).toBeUndefined();
    expect(responseFormatSchema(imageDesigner?.responseFormat)).toBe(imageDesignerResponseSchema);
    expect(responseFormatSchema(reviewer?.responseFormat)).toBe(reviewReportSchema);
  });

  it("lets an explicit clarifier responseFormat override the default schema", () => {
    const customSchema = clarificationResultSchema;
    const [clarifier] = createRuntimeScaffold({
      imageGenerationService: testImageGenerationService,
      clarifier: {
        responseFormat: customSchema,
      },
    }).subagents as SubAgent[];

    expect(clarifier?.responseFormat).toBe(customSchema);
  });

  it("threads model runtime assignments into default subagents", () => {
    const modelRuntime = createModelRuntime({
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
        "image-designer": "fast",
      },
    });
    const [clarifier, researcher, , imageDesigner] = createRuntimeScaffold({
      imageGenerationService: testImageGenerationService,
      modelRuntime,
    }).subagents as SubAgent[];

    expect((clarifier?.model as { model?: string }).model).toBe("fast-model");
    expect((researcher?.model as { model?: string }).model).toBe("normal-model");
    expect((imageDesigner?.model as { model?: string }).model).toBe("fast-model");
  });

  it("omits the image designer when image generation is not configured", () => {
    const subagents = createRuntimeScaffold().subagents as SubAgent[];

    expect(subagents.map((subagent) => subagent.name)).toEqual([
      "clarifier",
      "researcher",
      "analyst",
      "review-agent",
    ]);
  });

  it("assigns specialist execution tools by default", () => {
    const [, researcher, analyst, imageDesigner] = createRuntimeScaffold({
      imageGenerationService: testImageGenerationService,
    }).subagents as SubAgent[];

    expect(researcher?.tools?.map((tool) => tool.name)).toEqual(["execute_python"]);
    expect(analyst?.tools?.map((tool) => tool.name)).toEqual(["execute_python"]);
    expect(imageDesigner?.tools?.map((tool) => tool.name)).toEqual([IMAGE_DESIGNER_TOOL_NAME]);
  });

  it("leaves the supervisor prompt and subagents unchanged when generativeUi is absent", () => {
    const scaffold = createRuntimeScaffold({ promptLoader: testPromptLoader });

    expect(JSON.stringify(scaffold.systemPrompt)).not.toContain("product-card");
    expect(JSON.stringify(scaffold.systemPrompt)).not.toContain("NDJSON");
    expect(scaffold.generativeUi).toBeUndefined();
    expect(scaffold.productGeneration).toEqual({ enabled: false });
    expect(scaffold.review.requiredSubagent).toBe("review-agent");
    expect((scaffold.subagents as SubAgent[]).map((subagent) => subagent.name)).not.toContain(
      "product-generator",
    );
  });

  it("appends the product-generator NDJSON prompt, metadata, and subagent when generativeUi is enabled", () => {
    const scaffold = createRuntimeScaffold({
      promptLoader: testPromptLoader,
      imageGenerationService: testImageGenerationService,
      generativeUi: { catalogPrompt: "EXTRA CATALOG" },
    });

    expect(scaffold.generativeUi).toEqual({ catalogPrompt: "EXTRA CATALOG" });
    expect(scaffold.productGeneration).toEqual({
      enabled: true,
      requiredSubagent: "product-generator",
    });
    expect(scaffold.review.requiredSubagent).toBe("review-agent");
    expect(JSON.stringify(scaffold.systemPrompt)).toContain("supervisor prompt");
    expect(JSON.stringify(scaffold.systemPrompt)).toContain("newline-delimited JSON");
    expect(JSON.stringify(scaffold.systemPrompt)).toContain("product-card");
    expect(JSON.stringify(scaffold.systemPrompt)).toContain("EXTRA CATALOG");
    expect((scaffold.subagents as SubAgent[]).map((subagent) => subagent.name)).toContain(
      "product-generator",
    );
  });
});
