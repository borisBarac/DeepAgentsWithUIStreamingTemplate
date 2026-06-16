import { describe, expect, it } from "bun:test";
import { clarificationResultSchema } from "./clarification";
import type { PromptLoader } from "./prompts";
import {
  createDefaultInterrupts,
  createDefaultPermissions,
  createDefaultSubagents,
  createSupervisorBlueprint,
} from "./scaffold";
import { CLARIFY_DEEPLY_SKILL_DIR } from "./skills";

const testPromptLoader: PromptLoader = {
  getBaselinePrompt: () => "baseline prompt",
  getSupervisorPrompt: () => "supervisor prompt",
  getClarifierPrompt: () => "custom clarifier prompt",
  getResearcherPrompt: () => "custom researcher prompt",
  getAnalystPrompt: () => "custom analyst prompt",
  getCriticPrompt: () => "custom critic prompt",
};

describe("scaffolding defaults", () => {
  it("creates the default interrupt configuration for sensitive tools", () => {
    expect(createDefaultInterrupts()).toEqual({
      write_file: true,
      edit_file: true,
      execute: true,
    });
  });

  it("locks the filesystem down to the scaffold roots by default", () => {
    expect(createDefaultPermissions()).toEqual([
      {
        operations: ["read"],
        paths: ["/"],
      },
      {
        operations: ["read", "write"],
        paths: [
          "/scratch",
          "/scratch/**",
          "/plans",
          "/plans/**",
          "/reports",
          "/reports/**",
          "/artifacts",
          "/artifacts/**",
          "/memory",
          "/memory/**",
        ],
      },
      {
        operations: ["read"],
        paths: [
          "/scratch",
          "/scratch/**",
          "/plans",
          "/plans/**",
          "/reports",
          "/reports/**",
          "/artifacts",
          "/artifacts/**",
          "/memory",
          "/memory/**",
          "/skills",
          "/skills/**",
        ],
      },
      {
        operations: ["read", "write"],
        paths: ["/**"],
        mode: "deny",
      },
    ]);
  });

  it("provides specialist subagents for clarification, research, analysis, and critique", () => {
    const subagents = createDefaultSubagents();

    expect(subagents.map((subagent) => subagent.name)).toEqual([
      "clarifier",
      "researcher",
      "analyst",
      "critic",
    ]);
    expect(subagents.map((subagent) => subagent.tools)).toEqual([[], [], [], []]);
    expect(subagents.map((subagent) => subagent.skills)).toEqual([
      [CLARIFY_DEEPLY_SKILL_DIR],
      [],
      [],
      [],
    ]);
  });

  it("uses a custom prompt loader for default subagent prompts", () => {
    const subagents = createDefaultSubagents({}, {}, testPromptLoader);

    expect(subagents.map((subagent) => subagent.systemPrompt)).toEqual([
      "custom clarifier prompt",
      "custom researcher prompt",
      "custom analyst prompt",
      "custom critic prompt",
    ]);
  });

  it("lets explicit subagent prompt overrides win over the prompt loader", () => {
    const [clarifier] = createDefaultSubagents(
      {
        clarifier: {
          systemPrompt: "explicit clarifier prompt",
        },
      },
      {},
      testPromptLoader,
    );

    expect(clarifier?.systemPrompt).toBe("explicit clarifier prompt");
  });

  it("enforces structured output on the default clarifier only", () => {
    const [clarifier, researcher, analyst, critic] = createDefaultSubagents();

    expect(clarifier?.responseFormat).toBe(clarificationResultSchema);
    expect(researcher?.responseFormat).toBeUndefined();
    expect(analyst?.responseFormat).toBeUndefined();
    expect(critic?.responseFormat).toBeUndefined();
  });

  it("lets an explicit clarifier responseFormat override the default schema", () => {
    const customSchema = clarificationResultSchema;
    const [clarifier] = createDefaultSubagents({
      clarifier: {
        responseFormat: customSchema,
      },
    });

    expect(clarifier?.responseFormat).toBe(customSchema);
  });

  it("builds a supervisor blueprint with the recommended architecture", () => {
    const blueprint = createSupervisorBlueprint();

    expect(blueprint.architecture).toBe("supervisor-specialists");
    expect(blueprint.memoryFilePaths).toEqual(["/memory/AGENTS.md", "/memory/user-preferences.md"]);
    expect(blueprint.virtualFilesystem.reports).toBe("/reports");
    expect(blueprint.clarification.requiredSubagent).toBe("clarifier");
    expect(blueprint.clarification.config).toEqual({
      enabled: true,
      maxRounds: 10,
      questionsPerRound: 3,
      mode: "mandatory-preflight",
    });
  });

  it("threads custom prompt loaders through supervisor blueprints", () => {
    const blueprint = createSupervisorBlueprint({ promptLoader: testPromptLoader });

    expect(blueprint.subagents.map((subagent) => subagent.systemPrompt)).toEqual([
      "custom clarifier prompt",
      "custom researcher prompt",
      "custom analyst prompt",
      "custom critic prompt",
    ]);
  });
});
