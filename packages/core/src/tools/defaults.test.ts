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
        toolIds: ["python-sandbox"],
        purpose: "Evidence gathering, retrieval, search, and source collection.",
      },
      {
        role: "analyst",
        toolIds: ["python-sandbox"],
        purpose: "Computation, extraction, transformation, and file-based analysis.",
      },
      {
        role: "image-designer",
        toolIds: ["generate_image"],
        purpose:
          "Design production-ready image prompts and execute one generate-or-edit image operation.",
      },
      {
        role: "product-generator",
        toolIds: ["generate_image"],
        purpose:
          "Turn clarified product requests into a batch of structured product cards for the interaction zone.",
      },
      {
        role: "reviewer",
        toolIds: [],
        purpose: "Final quality review, approval decisions, and required-change verification.",
      },
    ]);
  });
});
