import { describe, expect, it } from "bun:test";
import type { ProductBatch } from "../workflow/products.ts";
import { productBatchToUiUpdate } from "./product-ui.ts";

const batch: ProductBatch = {
  mode: "create",
  gridRoot: "products",
  products: [
    { id: "prod-1", title: "Desk Lamp", description: "A compact adjustable lamp." },
    {
      id: "prod-2",
      title: "Wool Throw",
      description: "A soft neutral throw blanket.",
      imagePrompt: "A folded neutral wool throw on a chair",
    },
  ],
};

describe("productBatchToUiUpdate", () => {
  it("emits exactly one ui update rooted at gridRoot", () => {
    const update = productBatchToUiUpdate(batch);
    expect(update.type).toBe("ui");
    expect(update.rootId).toBe("products");
  });

  it("builds a ProductGrid with every product id in order as children", () => {
    const update = productBatchToUiUpdate(batch);
    const grid = update.components[0];
    expect(grid).toEqual({
      id: "products",
      component: "ProductGrid",
      children: ["prod-1", "prod-2"],
    });
  });

  it("builds one ProductCard per product with exact id/title/description", () => {
    const update = productBatchToUiUpdate(batch);
    const cards = update.components.slice(1);
    expect(cards).toHaveLength(2);
    expect(cards[0]).toEqual({
      id: "prod-1",
      component: "ProductCard",
      title: "Desk Lamp",
      description: "A compact adjustable lamp.",
    });
  });

  it("includes imagePrompt only when present on the product", () => {
    const update = productBatchToUiUpdate(batch);
    const cards = update.components.slice(1);
    expect(cards[0]?.imagePrompt).toBeUndefined();
    expect(cards[1]?.imagePrompt).toBe("A folded neutral wool throw on a chair");
  });

  it("omits imagePrompt entirely when no product carries one", () => {
    const noImage: ProductBatch = {
      mode: "create",
      gridRoot: "products",
      products: [{ id: "p", title: "T", description: "D" }],
    };
    const update = productBatchToUiUpdate(noImage);
    const card = update.components[1];
    expect("imagePrompt" in (card as object)).toBe(false);
  });

  it("preserves product order for arbitrary grid roots", () => {
    const custom: ProductBatch = {
      mode: "update",
      gridRoot: "catalog",
      products: [
        { id: "a", title: "A", description: "desc a" },
        { id: "b", title: "B", description: "desc b" },
        { id: "c", title: "C", description: "desc c" },
      ],
    };
    const update = productBatchToUiUpdate(custom);
    expect(update.rootId).toBe("catalog");
    expect(update.components[0]?.id).toBe("catalog");
    expect(update.components.slice(1).map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("produces no card-level fields beyond id/component/title/description/imagePrompt", () => {
    const update = productBatchToUiUpdate(batch);
    for (const card of update.components.slice(1)) {
      const keys = Object.keys(card).sort();
      expect(keys).toEqual(expect.arrayContaining(["component", "description", "id", "title"]));
      for (const key of keys) {
        expect(["component", "description", "id", "title", "imagePrompt", "children"]).toContain(
          key,
        );
      }
    }
  });
});
