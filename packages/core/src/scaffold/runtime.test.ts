import { describe, expect, it } from "bun:test";
import { type FilesystemPermission, StateBackend, type SubAgent } from "deepagents";

import type { PromptLoader } from "../prompts/index.ts";
import { createRuntimeScaffold } from "./runtime.ts";

const testPromptLoader: PromptLoader = {
  getSupervisorPrompt: () => "supervisor prompt",
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

function asDefaultSubagents(subagents: unknown): SubAgent[] {
  return subagents as SubAgent[];
}

describe("runtime scaffold defaults", () => {
  it("creates the default runtime shape", () => {
    const scaffold = createRuntimeScaffold({ imageGenerationService: testImageGenerationService });

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
        triage: { enabled: true },
      },
    });
    expect(scaffold.triage).toEqual({ enabled: false, classifier: undefined });
    expect(scaffold.review).toEqual({
      config: { maxRevisions: 4 },
      requiredSubagent: "review-agent",
    });
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
    expect(scaffold.subagents[0]?.name).toBe("custom");
    expect(scaffold.systemPrompt).toContain("explicit supervisor prompt");
    expect(scaffold.systemPrompt).toContain("Virtual filesystem contract");
    expect((scaffold.subagents[0] as SubAgent).systemPrompt).toContain(
      "Virtual filesystem contract",
    );
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
    expect(scaffold.review.requiredSubagent).toBe("review-agent");
    expect(scaffold.review.config.maxRevisions).toBe(4);
  });

  it("honours review revision overrides", () => {
    const scaffold = createRuntimeScaffold({ reviewOptions: { maxRevisions: 7 } });
    expect(scaffold.review.config.maxRevisions).toBe(7);
    expect(scaffold.review.config.maxRevisions).not.toBe(4);
  });

  it("keeps presentation instructions out of work prompt when generativeUi is enabled", () => {
    const scaffold = createRuntimeScaffold({
      promptLoader: testPromptLoader,
      imageGenerationService: testImageGenerationService,
      generativeUi: { catalogPrompt: "EXTRA CATALOG" },
    });

    expect(scaffold.generativeUi).toEqual({ catalogPrompt: "EXTRA CATALOG" });
    expect(scaffold.review.requiredSubagent).toBe("review-agent");
    expect(JSON.stringify(scaffold.systemPrompt)).toContain("supervisor prompt");
    expect(JSON.stringify(scaffold.systemPrompt)).not.toContain("Return one JSON object");
    expect(JSON.stringify(scaffold.systemPrompt)).not.toContain("product-card");
    expect(JSON.stringify(scaffold.systemPrompt)).not.toContain("EXTRA CATALOG");
    expect((scaffold.subagents as SubAgent[]).map((subagent) => subagent.name)).toEqual([
      "clarifier",
      "researcher",
      "analyst",
      "image-designer",
      "review-agent",
    ]);
  });
});
