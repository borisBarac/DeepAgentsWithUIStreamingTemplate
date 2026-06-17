import { describe, expect, it } from "bun:test";
import { type FilesystemPermission, StateBackend, type SubAgent } from "deepagents";

import { clarificationResultSchema } from "../clarification/index.ts";
import type { PromptLoader } from "../prompts/index.ts";
import { createRuntimeScaffold } from "./runtime.ts";

const testPromptLoader: PromptLoader = {
  getBaselinePrompt: () => "baseline prompt",
  getSupervisorPrompt: () => "supervisor prompt",
  getClarifierPrompt: () => "custom clarifier prompt",
  getResearcherPrompt: () => "custom researcher prompt",
  getAnalystPrompt: () => "custom analyst prompt",
  getCriticPrompt: () => "custom critic prompt",
};

function asDefaultSubagents(subagents: unknown): SubAgent[] {
  return subagents as SubAgent[];
}

describe("runtime scaffold defaults", () => {
  it("creates the default runtime shape", () => {
    const scaffold = createRuntimeScaffold();

    expect(scaffold.architecture).toBe("supervisor-specialists");
    expect(scaffold.memoryFilePaths).toEqual([
      "/memory/project-facts.md",
      "/memory/user-preferences.md",
    ]);
    expect(scaffold.memory).toEqual(["/memory/project-facts.md", "/memory/user-preferences.md"]);
    expect(scaffold.virtualFilesystem.reports).toBe("/reports");
    expect(scaffold.interruptOn).toEqual({
      write_file: true,
      edit_file: true,
      execute: true,
    });
    expect(scaffold.clarification).toEqual({
      requiredSubagent: "clarifier",
      config: {
        enabled: true,
        maxRounds: 10,
        questionsPerRound: 3,
        mode: "mandatory-preflight",
      },
    });
  });

  it("lets explicit runtime overrides win over defaults", () => {
    const customBackend = new StateBackend();
    const customInterrupts = { execute: false };
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
    const scaffold = createRuntimeScaffold({ promptLoader: testPromptLoader });
    const subagents = asDefaultSubagents(scaffold.subagents);

    expect(subagents.map((subagent) => subagent.systemPrompt)).toEqual([
      "custom clarifier prompt",
      "custom researcher prompt",
      "custom analyst prompt",
      "custom critic prompt",
    ]);
    expect(scaffold.systemPrompt).toBe("supervisor prompt");
  });

  it("lets explicit subagent prompt overrides win over the prompt loader", () => {
    const [clarifier] = asDefaultSubagents(
      createRuntimeScaffold({
        promptLoader: testPromptLoader,
        clarifier: {
          systemPrompt: "explicit clarifier prompt",
        },
      }).subagents,
    );

    expect(clarifier?.systemPrompt).toBe("explicit clarifier prompt");
  });

  it("enforces structured output on the default clarifier only", () => {
    const [clarifier, researcher, analyst, critic] = asDefaultSubagents(
      createRuntimeScaffold().subagents,
    );

    expect(clarifier?.responseFormat).toBe(clarificationResultSchema);
    expect(researcher?.responseFormat).toBeUndefined();
    expect(analyst?.responseFormat).toBeUndefined();
    expect(critic?.responseFormat).toBeUndefined();
  });

  it("lets an explicit clarifier responseFormat override the default schema", () => {
    const customSchema = clarificationResultSchema;
    const [clarifier] = createRuntimeScaffold({
      clarifier: {
        responseFormat: customSchema,
      },
    }).subagents as SubAgent[];

    expect(clarifier?.responseFormat).toBe(customSchema);
  });
});
