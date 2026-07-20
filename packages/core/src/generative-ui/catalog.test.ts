import { describe, expect, it } from "bun:test";

import {
  catalog,
  catalogComponentNames,
  catalogLimits,
  catalogVersion,
  getComponentSchema,
  isKnownComponent,
} from "./catalog.ts";

describe("a2ui catalog loader", () => {
  it("loads the catalog from disk with the expected metadata", () => {
    expect(catalogVersion).toBe(1);
    expect(catalogLimits).toEqual({
      maxComponents: 100,
      maxStringLength: 4_096,
      maxJsonBytes: 128 * 1_024,
    });
  });

  it("exposes every existing component name", () => {
    expect(catalogComponentNames).toEqual(
      expect.arrayContaining([
        "Button",
        "Card",
        "ImagePlaceholder",
        "ProductCard",
        "ProductGrid",
        "Stack",
        "Text",
        "TextInput",
      ]),
    );
    expect(catalogComponentNames).toHaveLength(8);
  });

  it("preserves insertion order from the JSON file", () => {
    // Catalog prompt parity test depends on this order being stable.
    expect(catalogComponentNames).toEqual([
      "Button",
      "Card",
      "ImagePlaceholder",
      "ProductCard",
      "ProductGrid",
      "Stack",
      "Text",
      "TextInput",
    ]);
  });

  it("knows which components are in the catalog", () => {
    expect(isKnownComponent("Button")).toBe(true);
    expect(isKnownComponent("product-card")).toBe(false);
    expect(isKnownComponent("Mystery")).toBe(false);
    expect(isKnownComponent("button")).toBe(false);
    expect(isKnownComponent("")).toBe(false);
  });

  it("returns the schema for known components and undefined otherwise", () => {
    expect(getComponentSchema("Button")).toBeDefined();
    expect(getComponentSchema("Button")?.required).toEqual(["label"]);
    expect(getComponentSchema("ProductCard")?.required).toEqual(["title", "description"]);
    expect(getComponentSchema("Mystery")).toBeUndefined();
    expect(getComponentSchema("product-card")).toBeUndefined();
  });

  it("declares additionalProperties:false on every component", () => {
    // This is the property that lets the validator reject off-catalog props.
    for (const name of catalogComponentNames) {
      const schema = catalog.components[name];
      expect(schema?.additionalProperties).toBe(false);
    }
  });

  it("carries the limits the validator shares with the client mini-validator", () => {
    // Server and client must agree — these numbers ship with the catalog doc.
    expect(catalog.limits.maxComponents).toBeGreaterThan(0);
    expect(catalog.limits.maxStringLength).toBeGreaterThan(0);
    expect(catalog.limits.maxJsonBytes).toBeGreaterThan(0);
  });
});
