import { describe, expect, it } from "bun:test";

import { DEFAULT_GUARDRAIL_POLICY_LOADER, MarkdownGuardrailPolicyLoader } from "./policies.ts";

describe("guardrail policies", () => {
  it("loads task-scope policy from markdown", () => {
    const loader = new MarkdownGuardrailPolicyLoader();

    expect(loader.getRequiredContextPolicy()).toContain("Required Context");
    expect(loader.getAllowedTasksPolicy()).toContain("Allowed Tasks");
    expect(loader.getDisallowedTasksPolicy()).toContain("Disallowed Tasks");
  });

  it("exports the default markdown policy loader", () => {
    expect(DEFAULT_GUARDRAIL_POLICY_LOADER.getAllowedTasksPolicy()).toContain(
      "Deep Agent Template project",
    );
  });
});
