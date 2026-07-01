import { describe, expect, it } from "bun:test";
import { type FilesystemPermission, StateBackend, type SubAgent } from "deepagents";

import type { PromptLoader } from "../prompts/index.ts";
import { createRuntimeScaffold } from "./runtime.ts";

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

  it("creates a baseline scaffold without supervisor-specialist defaults", () => {
    const scaffold = createRuntimeScaffold({
      mode: "baseline",
      promptLoader: testPromptLoader,
      generativeUi: { catalogPrompt: "BASELINE CATALOG" },
    });

    expect(scaffold.architecture).toBe("baseline");
    expect(scaffold.systemPrompt).toContain("baseline prompt");
    expect(scaffold.systemPrompt).toContain("BASELINE CATALOG");
    expect(scaffold.systemPrompt).toContain("newline-delimited JSON");
    expect(scaffold.backend).toBeUndefined();
    expect(scaffold.memory).toBeUndefined();
    expect(scaffold.memoryFilePaths).toEqual([]);
    expect(scaffold.permissions).toBeUndefined();
    expect(scaffold.subagents).toEqual([]);
    expect(scaffold.clarification).toBeUndefined();
    expect(scaffold.productGeneration).toBeUndefined();
    expect(scaffold.review).toBeUndefined();
    expect(JSON.stringify(scaffold.systemPrompt)).not.toContain("product-card");
  });
});
