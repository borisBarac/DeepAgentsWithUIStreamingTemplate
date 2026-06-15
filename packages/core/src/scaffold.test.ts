import { describe, expect, it } from "bun:test";

import {
  createDefaultInterrupts,
  createDefaultPermissions,
  createDefaultSubagents,
  createSupervisorBlueprint,
} from "./scaffold";

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

  it("provides specialist subagents for research, analysis, and critique", () => {
    const subagents = createDefaultSubagents();

    expect(subagents.map((subagent) => subagent.name)).toEqual(["researcher", "analyst", "critic"]);
    expect(subagents.map((subagent) => subagent.tools)).toEqual([[], [], []]);
    expect(subagents.map((subagent) => subagent.skills)).toEqual([[], [], []]);
  });

  it("builds a supervisor blueprint with the recommended architecture", () => {
    const blueprint = createSupervisorBlueprint();

    expect(blueprint.architecture).toBe("supervisor-specialists");
    expect(blueprint.memoryFilePaths).toEqual(["/memory/AGENTS.md", "/memory/user-preferences.md"]);
    expect(blueprint.virtualFilesystem.reports).toBe("/reports");
  });
});
