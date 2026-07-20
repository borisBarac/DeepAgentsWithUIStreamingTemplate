import { describe, expect, it } from "bun:test";

import { KNOWN_SUBAGENT_LABELS, labelSubagent } from "./subagent-labels.ts";

describe("labelSubagent", () => {
  it("returns human-friendly labels for known catalog subagents", () => {
    expect(labelSubagent("clarifier")).toBe("Clarifier");
    expect(labelSubagent("researcher")).toBe("Researcher");
    expect(labelSubagent("analyst")).toBe("Analyst");
    expect(labelSubagent("image-designer")).toBe("Image designer");
    expect(labelSubagent("product-generator")).toBe("Product generator");
  });

  it('labels both "reviewer" and "review-agent" as "Reviewer"', () => {
    expect(labelSubagent("reviewer")).toBe("Reviewer");
    expect(labelSubagent("review-agent")).toBe("Reviewer");
  });

  it('labels the auto-added general-purpose subagent as "General purpose"', () => {
    expect(labelSubagent("general-purpose")).toBe("General purpose");
  });

  it('labels the coordinator as "Main agent"', () => {
    expect(labelSubagent("coordinator")).toBe("Main agent");
  });

  it("title-cases unknown kebab-case names", () => {
    expect(labelSubagent("my-custom-agent")).toBe("My Custom Agent");
    expect(labelSubagent("under_scored_name")).toBe("Under Scored Name");
  });

  it('returns "Subagent" for empty or nullish input', () => {
    expect(labelSubagent(undefined)).toBe("Subagent");
    expect(labelSubagent(null)).toBe("Subagent");
    expect(labelSubagent("")).toBe("Subagent");
  });

  it("exposes the label table for parity checks", () => {
    expect(KNOWN_SUBAGENT_LABELS["general-purpose"]).toBe("General purpose");
    expect(Object.keys(KNOWN_SUBAGENT_LABELS).length).toBeGreaterThanOrEqual(7);
  });
});
