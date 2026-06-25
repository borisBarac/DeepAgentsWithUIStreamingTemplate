import type { SpecialistRole } from "../scaffold/index.ts";

import type { SpecializedRoleToolset } from "./types.ts";

const DEFAULT_SPECIALIST_ROLE_PURPOSES: Record<SpecialistRole, string> = {
  clarifier: "Structured intake, requirement checks, and preflight readiness gating.",
  researcher: "Evidence gathering, retrieval, search, and source collection.",
  analyst: "Computation, extraction, transformation, and file-based analysis.",
  "image-designer":
    "Design production-ready image prompts and execute one generate-or-edit image operation.",
  "product-generator":
    "Turn clarified product requests into a batch of structured product cards for the interaction zone.",
  reviewer: "Final quality review, approval decisions, and required-change verification.",
};

function freezeRoleToolsets<TRole extends SpecialistRole>(
  roles: readonly SpecializedRoleToolset<TRole>[],
): readonly SpecializedRoleToolset<TRole>[] {
  return Object.freeze(
    roles.map((roleToolset) =>
      Object.freeze({
        ...roleToolset,
        toolIds: Object.freeze([...roleToolset.toolIds]),
      }),
    ),
  );
}

export function createDefaultSpecialistRoleToolsets(): readonly SpecializedRoleToolset<SpecialistRole>[] {
  return freezeRoleToolsets([
    {
      role: "clarifier",
      toolIds: [],
      purpose: DEFAULT_SPECIALIST_ROLE_PURPOSES.clarifier,
    },
    {
      role: "researcher",
      toolIds: ["python-sandbox"],
      purpose: DEFAULT_SPECIALIST_ROLE_PURPOSES.researcher,
    },
    {
      role: "analyst",
      toolIds: ["python-sandbox"],
      purpose: DEFAULT_SPECIALIST_ROLE_PURPOSES.analyst,
    },
    {
      role: "image-designer",
      toolIds: ["generate_image"],
      purpose: DEFAULT_SPECIALIST_ROLE_PURPOSES["image-designer"],
    },
    {
      role: "product-generator",
      toolIds: ["generate_image"],
      purpose: DEFAULT_SPECIALIST_ROLE_PURPOSES["product-generator"],
    },
    {
      role: "reviewer",
      toolIds: [],
      purpose: DEFAULT_SPECIALIST_ROLE_PURPOSES.reviewer,
    },
  ]);
}
