import { describe, expect, it } from "bun:test";
import {
  catalog,
  catalogComponentNames,
  catalogPrompt,
  validateComponentInstance,
  validateUpdate,
} from "@deep-agent-template/core/generative-ui";

import { registry } from "./catalog.tsx";

const validSamples: Record<string, Record<string, unknown>> = {
  Button: { label: "Continue", action: "demo_action" },
  Card: { title: "Overview" },
  ImagePlaceholder: { alt: "Preview", prompt: "Landscape mockup" },
  ProductCard: {
    title: "Launch Map",
    description: "A planning workspace for design teams.",
    imagePrompt: "Kanban board with milestones",
  },
  ProductGrid: { heading: "Concepts" },
  Stack: { direction: "row", gap: "md" },
  Text: { text: "Hello", variant: "body" },
  TextInput: { label: "Email", name: "email", inputType: "email" },
};

describe("schema contract", () => {
  it("accepts valid props for every catalog.json component", () => {
    for (const component of catalogComponentNames) {
      expect(catalog.components[component]).toBeDefined();
      expect(
        validateComponentInstance({
          id: `${component}-sample`,
          component,
          ...validSamples[component],
        }).ok,
      ).toBe(true);
    }
  });

  it("rejects missing required props for key components", () => {
    expect(validateComponentInstance({ id: "button", component: "Button" }).ok).toBe(false);
    expect(
      validateComponentInstance({ id: "card", component: "ProductCard", title: "Launch Map" }).ok,
    ).toBe(false);
    expect(validateComponentInstance({ id: "text", component: "Text" }).ok).toBe(false);
    expect(
      validateComponentInstance({ id: "input", component: "TextInput", name: "email" }).ok,
    ).toBe(false);
  });

  it("validates a renderer-ready update whose components exist in the registry", () => {
    const result = validateUpdate({
      type: "ui",
      rootId: "grid",
      components: [
        {
          id: "grid",
          component: "ProductGrid",
          heading: "Concepts",
          children: ["card", "cta"],
        },
        {
          id: "card",
          component: "ProductCard",
          title: "Launch Map",
          description: "A planning workspace for design teams.",
          imagePrompt: "Kanban board with milestones",
          children: ["summary"],
        },
        {
          id: "summary",
          component: "Text",
          text: "Early concept",
          variant: "muted",
          children: [],
        },
        { id: "cta", component: "Button", label: "Open details", children: [] },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok || result.update.type !== "ui") {
      throw new Error("expected a valid ui update");
    }

    for (const component of result.update.components) {
      expect(registry[component.component]).toBeDefined();
    }
  });

  it("keeps the catalog prompt aligned with the component list", () => {
    for (const component of catalogComponentNames) {
      expect(catalogPrompt).toContain(component);
    }
  });

  it("has a React renderer for every catalog.json entry", () => {
    // catalog.json is the single source of truth; this guard fails the moment
    // someone adds a component to catalog.json without shipping a renderer.
    for (const name of catalogComponentNames) {
      expect(registry[name as keyof typeof registry]).toBeDefined();
    }
  });

  it("has a catalog.json entry for every React renderer", () => {
    // And conversely: every renderer must have a catalog entry. A renderer
    // without a catalog entry can never receive a validated instance.
    const catalogSet = new Set(catalogComponentNames);
    for (const name of Object.keys(registry)) {
      expect(catalogSet.has(name)).toBe(true);
    }
  });
});
