import { describe, expect, it } from "bun:test";

import { normalizeStreamingSpec } from "./normalize.ts";

describe("normalizeStreamingSpec", () => {
  it("accepts a complete approved spec", () => {
    expect(
      normalizeStreamingSpec({
        root: "root",
        elements: {
          root: { type: "Card", props: {}, children: ["text"] },
          text: { type: "Text", props: { text: "Hello" }, children: [] },
        },
      }),
    ).toEqual({
      root: "root",
      elements: {
        root: { type: "Card", props: {}, children: ["text"] },
        text: { type: "Text", props: { text: "Hello" }, children: [] },
      },
    });
  });

  it("accepts product grids with product cards", () => {
    expect(
      normalizeStreamingSpec({
        root: "products",
        elements: {
          products: { type: "ProductGrid", props: { heading: "Concepts" }, children: ["card"] },
          card: {
            type: "ProductCard",
            props: {
              title: "Launch Map",
              description: "A planning workspace for design teams.",
              imagePrompt: "Kanban board with product milestones",
            },
            children: [],
          },
        },
      }),
    ).toEqual({
      root: "products",
      elements: {
        products: { type: "ProductGrid", props: { heading: "Concepts" }, children: ["card"] },
        card: {
          type: "ProductCard",
          props: {
            title: "Launch Map",
            description: "A planning workspace for design teams.",
            imagePrompt: "Kanban board with product milestones",
          },
          children: [],
        },
      },
    });
  });

  it("accepts scaffold product-card specs without explicit children", () => {
    expect(
      normalizeStreamingSpec({
        root: "concept-1",
        elements: {
          "concept-1": {
            type: "product-card",
            props: {
              id: "concept-1",
              title: "Launch Map",
              description: "A planning workspace for design teams.",
              status: "complete",
            },
          },
        },
      }),
    ).toEqual({
      root: "concept-1",
      elements: {
        "concept-1": {
          type: "product-card",
          props: {
            id: "concept-1",
            title: "Launch Map",
            description: "A planning workspace for design teams.",
            status: "complete",
          },
          children: [],
        },
      },
    });
  });

  it("accepts scaffold product-card specs with generated image URLs", () => {
    expect(
      normalizeStreamingSpec({
        root: "concept-1",
        elements: {
          "concept-1": {
            type: "product-card",
            props: {
              id: "concept-1",
              title: "Launch Map",
              description: "A planning workspace for design teams.",
              imageUrl: "https://example.com/launch-map.png",
            },
            children: [],
          },
        },
      }),
    ).toEqual({
      root: "concept-1",
      elements: {
        "concept-1": {
          type: "product-card",
          props: {
            id: "concept-1",
            title: "Launch Map",
            description: "A planning workspace for design teams.",
            imageUrl: "https://example.com/launch-map.png",
          },
          children: [],
        },
      },
    });
  });

  it("rejects product cards without required details", () => {
    expect(
      normalizeStreamingSpec({
        root: "products",
        elements: {
          products: { type: "ProductGrid", props: {}, children: ["card"] },
          card: {
            type: "ProductCard",
            props: { title: "Missing description" },
            children: [],
          },
        },
      }),
    ).toBeNull();
  });

  it("rejects unknown component types", () => {
    expect(
      normalizeStreamingSpec({
        root: "root",
        elements: {
          root: { type: "Image", props: {}, children: [] },
        },
      }),
    ).toBeNull();
  });

  it("rejects missing props", () => {
    expect(
      normalizeStreamingSpec({
        root: "root",
        elements: {
          root: { type: "Card", children: [] },
        },
      }),
    ).toBeNull();
  });

  it("rejects missing child references", () => {
    expect(
      normalizeStreamingSpec({
        root: "root",
        elements: {
          root: { type: "Card", props: {}, children: ["missing"] },
        },
      }),
    ).toBeNull();
  });
});
