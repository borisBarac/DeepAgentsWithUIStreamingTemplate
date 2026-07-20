import { describe, expect, it } from "bun:test";

import { extractLatestProductSet, productContext, requestedProductCount } from "./products.ts";

function assistantOutput(components: unknown[], rootId?: string) {
  return {
    role: "assistant",
    content: JSON.stringify({ version: 1, updates: [{ type: "ui", rootId, components }] }),
  };
}

describe("product workflow context", () => {
  it("detects ProductCard instances and prefers the grid root", () => {
    const canonical = assistantOutput(
      [
        { id: "catalog", component: "ProductGrid", children: ["a", "b"] },
        { id: "a", component: "ProductCard", title: "A", description: "First" },
        { id: "b", component: "ProductCard", title: "B", description: "Second" },
      ],
      "catalog",
    );
    expect(extractLatestProductSet([canonical])).toEqual({
      gridRoot: "catalog",
      products: [
        { id: "a", title: "A", description: "First" },
        { id: "b", title: "B", description: "Second" },
      ],
    });
  });

  it("uses products as the default grid root when no ProductGrid is present", () => {
    const cards = assistantOutput([
      { id: "old", component: "ProductCard", title: "Old", description: "Legacy" },
    ]);
    const message = {
      role: "assistant",
      content: JSON.stringify({ version: 1, updates: [{ type: "message", text: "Answer" }] }),
    };
    expect(extractLatestProductSet([cards, message])?.gridRoot).toBe("products");
  });

  it("preserves old count unless a numeric or word count is requested", () => {
    const history = [
      assistantOutput(
        [
          { id: "products", component: "ProductGrid", children: ["a", "b"] },
          { id: "a", component: "ProductCard", title: "A", description: "A" },
          { id: "b", component: "ProductCard", title: "B", description: "B" },
        ],
        "products",
      ),
    ];
    expect(productContext(history, "make them brighter").targetProductCount).toBe(2);
    expect(productContext(history, "replace with five products").targetProductCount).toBe(5);
    expect(requestedProductCount("show 7 products")).toBe(7);
    expect(productContext([], "create products").targetProductCount).toBe(3);
  });
});
