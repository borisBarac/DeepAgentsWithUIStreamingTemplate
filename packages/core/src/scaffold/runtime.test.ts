import { describe, expect, it } from "bun:test";
import { tool } from "@langchain/core/tools";
import { type FilesystemPermission, StateBackend, type SubAgent } from "deepagents";
import { z } from "zod";

import type { PromptLoader } from "../prompts/index.ts";
import { createRuntimeScaffold } from "./runtime.ts";

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
      },
    });
    expect(scaffold.review).toEqual({
      config: { maxReviewCycles: 4 },
      requiredSubagent: "review-agent",
    });
  });

  it("adds LinkLoom tools to the researcher without changing analyst tools", () => {
    const linkloomSearch = tool(async ({ query }) => query, {
      name: "linkloom_search",
      description: "Search LinkLoom.",
      schema: z.object({ query: z.string() }),
    });
    const scaffold = createRuntimeScaffold({ additionalResearcherTools: [linkloomSearch] });
    const subagents = asDefaultSubagents(scaffold.subagents);
    const researcher = subagents.find((subagent) => subagent.name === "researcher");
    const analyst = subagents.find((subagent) => subagent.name === "analyst");

    expect(researcher?.tools?.map((researcherTool) => researcherTool.name)).toEqual([
      "execute_python",
      "linkloom_search",
    ]);
    expect(researcher?.tools?.[1]).toBe(linkloomSearch);
    expect(analyst?.tools?.map((analystTool) => analystTool.name)).toEqual(["execute_python"]);
  });

  it("lets explicit runtime overrides win over defaults", () => {
    const customBackend = new StateBackend();
    const customInterrupts = { execute_python: false };
    const customMemory = ["/memory/custom.md"];
    const customPermissions: FilesystemPermission[] = [
      { operations: ["read"], paths: ["/custom"] },
    ];
    const customSubagents: SubAgent[] = [
      { name: "clarifier", description: "Clarifier", systemPrompt: "clarifier prompt" },
      { name: "review-agent", description: "Review", systemPrompt: "review prompt" },
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
    expect(scaffold.subagents[2]?.name).toBe("custom");
    expect(scaffold.systemPrompt).toContain("explicit supervisor prompt");
    expect(scaffold.systemPrompt).toContain("Virtual filesystem contract");
    expect((scaffold.subagents[2] as SubAgent).systemPrompt).toContain(
      "Virtual filesystem contract",
    );
  });

  it("applies custom clarification limits to runtime prompts and subagents", () => {
    const scaffold = createRuntimeScaffold({
      imageGenerationService: testImageGenerationService,
      clarificationOptions: {
        questionsPerRound: 2,
      },
    });

    expect(scaffold.clarification.config.maxRounds).toBe(2);
    expect(scaffold.clarification.config.questionsPerRound).toBe(2);
    expect(scaffold.systemPrompt).toContain("after 2 rounds");
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
    expect(scaffold.review.config.maxReviewCycles).toBe(4);
  });

  it("honours review revision overrides", () => {
    const scaffold = createRuntimeScaffold({ reviewOptions: { maxReviewCycles: 7 } });
    expect(scaffold.review.config.maxReviewCycles).toBe(7);
    expect(scaffold.review.config.maxReviewCycles).not.toBe(4);
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
      "product-generator",
      "image-designer",
      "review-agent",
    ]);
    expect(scaffold.productGeneration).toEqual({
      enabled: true,
      requiredSubagent: "product-generator",
    });
  });
});

describe("createRuntimeScaffold required subagents", () => {
  // The assertion guards the workflow contract: any catalog driving the
  // multi-phase controller must surface clarifier, review-agent (and
  // product-generator when generativeUi is on). This holds for the default
  // catalog AND for an explicit `subagents` array — an incomplete explicit
  // catalog would otherwise build and then fail at runtime. Callers that
  // intentionally supply a subset (isolated tests, memory-only agents) opt
  // out via `workflowEnabled: false`.

  it("throws when explicit subagents omit required roles", () => {
    expect(() =>
      createRuntimeScaffold({
        subagents: [{ name: "clarifier", description: "c", systemPrompt: "c" }],
      }),
    ).toThrow("missing required subagent(s): review-agent");
  });

  it("throws when explicit subagents are empty", () => {
    expect(() => createRuntimeScaffold({ subagents: [] })).toThrow(
      "missing required subagent(s): clarifier, review-agent",
    );
  });

  it("does not throw when workflow is disabled and subagents omit required roles", () => {
    // Mirrors e2e/memory.e2e.test.ts buildMemoryAgent which uses an empty
    // subagent list for a memory-only scenario.
    expect(() => createRuntimeScaffold({ subagents: [], workflowEnabled: false })).not.toThrow();
    // Mirrors e2e/subagents.e2e.test.ts buildClarifierAgent which passes only
    // the clarifier.
    expect(() =>
      createRuntimeScaffold({
        subagents: [{ name: "clarifier", description: "c", systemPrompt: "c" }],
        workflowEnabled: false,
      }),
    ).not.toThrow();
  });

  it("does not throw when workflow is disabled and explicit subagents are empty with generativeUi", () => {
    // Even with generativeUi (which would require product-generator in the
    // default catalog), the opt-out bypasses the assertion.
    expect(() =>
      createRuntimeScaffold({ subagents: [], generativeUi: {}, workflowEnabled: false }),
    ).not.toThrow();
  });

  it("registers all required subagents in the default catalog", () => {
    // This is the positive form of what the assertion guards: the default
    // catalog must always surface clarifier, review-agent, and (when
    // generativeUi is enabled) product-generator.
    const plain = createRuntimeScaffold({});
    const plainNames = new Set(plain.subagents.map((s) => s.name));
    expect(plainNames.has("clarifier")).toBe(true);
    expect(plainNames.has("review-agent")).toBe(true);

    const withUi = createRuntimeScaffold({ generativeUi: {} });
    const uiNames = new Set(withUi.subagents.map((s) => s.name));
    expect(uiNames.has("clarifier")).toBe(true);
    expect(uiNames.has("review-agent")).toBe(true);
    expect(uiNames.has("product-generator")).toBe(true);
  });
});
