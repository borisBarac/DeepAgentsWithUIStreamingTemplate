import { describe, expect, it } from "bun:test";

import { createDefaultSpecialistRoleToolsets } from "./defaults.ts";

describe("default specialist role toolsets", () => {
  it("provides explicit default specialist role bundles", () => {
    expect(createDefaultSpecialistRoleToolsets()).toEqual([
      {
        role: "clarifier",
        toolIds: [],
        purpose: "Structured intake, requirement checks, and preflight readiness gating.",
      },
      {
        role: "researcher",
        toolIds: [],
        purpose: "Evidence gathering, retrieval, search, and source collection.",
      },
      {
        role: "analyst",
        toolIds: [],
        purpose: "Computation, extraction, transformation, and file-based analysis.",
      },
      {
        role: "image-designer",
        toolIds: ["generate_image"],
        purpose:
          "Design production-ready image prompts and execute one generate-or-edit image operation.",
      },
      {
        role: "reviewer",
        toolIds: [],
        purpose: "Final quality review, approval decisions, and required-change verification.",
      },
    ]);
  });
});
