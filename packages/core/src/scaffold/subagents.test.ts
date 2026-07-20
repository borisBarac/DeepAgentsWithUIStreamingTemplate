import { describe, expect, it } from "bun:test";
import type { SandboxBackend } from "@deep-agent-template/sandbox";
import { tool } from "@langchain/core/tools";
import type { SubAgent } from "deepagents";
import type { AgentMiddleware } from "langchain";
import { z } from "zod";

import { IMAGE_DESIGNER_TOOL_NAME } from "../image-designer/index.ts";
import { createModelRuntime } from "../models/index.ts";
import type { PromptLoader } from "../prompts/index.ts";
import { CLARIFY_DEEPLY_SKILL_DIR } from "../skills/index.ts";
import { createDefaultSubagentCatalog } from "./subagents.ts";

const testPromptLoader: PromptLoader = {
  getSupervisorPrompt: () => "supervisor prompt",
  getClarifierPrompt: () => "custom clarifier prompt",
  getResearcherPrompt: () => "custom researcher prompt",
  getAnalystPrompt: () => "custom analyst prompt",
  getImageDesignerPrompt: () => "custom image designer prompt",
  getReviewAgentPrompt: () => "custom review prompt",
  getProductGeneratorPrompt: () => "custom product generator prompt",
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

    expect(subagents[0]?.systemPrompt).toContain("custom clarifier prompt");
    expect(subagents[1]?.systemPrompt).toContain("custom researcher prompt");
    expect(subagents[2]?.systemPrompt).toContain("custom analyst prompt");
    expect(subagents[3]?.systemPrompt).toContain("custom image designer prompt");
    expect(subagents[4]?.systemPrompt).toContain("custom review prompt");
    expect(subagents.every((subagent) => subagent.systemPrompt.includes("/home/user"))).toBeTrue();
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

    expect(clarifier?.systemPrompt).toContain("explicit clarifier prompt");
    expect(clarifier?.systemPrompt).toContain("Virtual filesystem contract");
  });

  it("leaves every default subagent response format and middleware unset", () => {
    const subagents = asDefaultSubagents(
      createDefaultSubagentCatalog({ imageGenerationService: testImageGenerationService }),
    );

    expect(subagents.every((subagent) => subagent.responseFormat === undefined)).toBeTrue();
    expect(subagents.every((subagent) => subagent.middleware === undefined)).toBeTrue();
  });

  it("appends scaffold middleware after caller middleware", () => {
    const callerMiddleware: AgentMiddleware = { name: "caller" };
    const clarifier = createDefaultSubagentCatalog({
      clarifier: { middleware: [callerMiddleware] },
    }).byRole.clarifier;

    expect(clarifier?.middleware?.map((middleware) => middleware.name)).toEqual(["caller"]);
  });

  it("retains caller middleware when no responseFormat is supplied", () => {
    const callerMiddleware: AgentMiddleware = { name: "caller" };
    const reviewer = createDefaultSubagentCatalog({
      reviewer: {
        middleware: [callerMiddleware],
      },
    }).byRole.reviewer;

    expect(reviewer?.responseFormat).toBeUndefined();
    expect(reviewer?.middleware?.map((middleware) => middleware.name)).toEqual(["caller"]);
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

  it("adds product-generator when generativeUi is enabled", () => {
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
      "product-generator",
      "image-designer",
      "review-agent",
    ]);
  });
});
