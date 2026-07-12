import { describe, expect, it } from "bun:test";

import {
  catalogPrompt,
  componentPropsSchemas,
  componentTypes,
  normalizeStreamingSpec,
} from "./contract.ts";
import { productCardSchema } from "./envelope.ts";

const validSamples = {
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
  "product-card": {
    id: "concept-1",
    title: "Launch Map",
    description: "A planning workspace for design teams.",
    imageUrl: "https://example.com/launch-map.png",
    status: "complete",
  },
} as const;

describe("generative-ui contract", () => {
  it("exposes a schema for every component type", () => {
    expect(componentTypes).toEqual([
      "Button",
      "Card",
      "ImagePlaceholder",
      "ProductCard",
      "ProductGrid",
      "Stack",
      "Text",
      "TextInput",
      "product-card",
    ]);

    for (const type of componentTypes) {
      expect(componentPropsSchemas[type]).toBeDefined();
      expect(componentPropsSchemas[type].safeParse(validSamples[type]).success).toBe(true);
    }
  });

  it("reuses the core product-card schema for scaffold cards", () => {
    expect(componentPropsSchemas["product-card"]).toBe(productCardSchema);
  });

  it("rejects missing required props for key components", () => {
    expect(componentPropsSchemas.Button.safeParse({}).success).toBe(false);
    expect(componentPropsSchemas.ProductCard.safeParse({ title: "Launch Map" }).success).toBe(
      false,
    );
    expect(
      componentPropsSchemas["product-card"].safeParse({
        title: "Launch Map",
        description: "A planning workspace.",
      }).success,
    ).toBe(false);
    expect(componentPropsSchemas.Text.safeParse({}).success).toBe(false);
    expect(componentPropsSchemas.TextInput.safeParse({ name: "email" }).success).toBe(false);
  });

  it("normalizes a renderer-ready spec", () => {
    expect(
      normalizeStreamingSpec({
        root: "grid",
        elements: {
          grid: {
            type: "ProductGrid",
            props: { heading: "Concepts" },
            children: ["card", "cta"],
          },
          card: {
            type: "ProductCard",
            props: {
              title: "Launch Map",
              description: "A planning workspace for design teams.",
              imagePrompt: "Kanban board with milestones",
            },
            children: ["summary"],
          },
          summary: {
            type: "Text",
            props: { text: "Early concept", variant: "muted" },
            children: [],
          },
          cta: {
            type: "Button",
            props: { label: "Open details" },
            children: [],
          },
        },
      }),
    ).toEqual({
      root: "grid",
      elements: {
        grid: {
          type: "ProductGrid",
          props: { heading: "Concepts" },
          children: ["card", "cta"],
        },
        card: {
          type: "ProductCard",
          props: {
            title: "Launch Map",
            description: "A planning workspace for design teams.",
            imagePrompt: "Kanban board with milestones",
          },
          children: ["summary"],
        },
        summary: {
          type: "Text",
          props: { text: "Early concept", variant: "muted" },
          children: [],
        },
        cta: {
          type: "Button",
          props: { label: "Open details" },
          children: [],
        },
      },
    });
  });

  it("keeps the catalog prompt aligned with the component list", () => {
    for (const type of componentTypes) {
      expect(catalogPrompt).toContain(type);
    }
  });

  it("includes schema-derived prop descriptions in the catalog prompt", () => {
    expect(catalogPrompt).toContain(`Allowed component props:
- Button: {"label": string, "action"?: string}
- Card: {"title"?: string}
- ImagePlaceholder: {"alt"?: string, "prompt"?: string}
- ProductCard: {"title": string, "description": string, "imageAlt"?: string, "imagePrompt"?: string}
- ProductGrid: {"heading"?: string}
- Stack: {"direction"?: "row" | "column", "gap"?: "xs" | "sm" | "md" | "lg"}
- Text: {"text": string, "variant"?: "title" | "body" | "muted" | "caption"}
- TextInput: {"label": string, "name": string, "placeholder"?: string, "inputType"?: "text" | "email" | "password"}
- product-card: {"id": string, "title": string, "description": string, "imageUrl"?: string, "status"?: "streaming" | "complete"}`);
  });
});
