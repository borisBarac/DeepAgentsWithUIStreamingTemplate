import type { ProductBatch } from "../workflow/products.ts";
import type { ComponentInstance, UiSpecUpdate, UiUpdate } from "./types.ts";

/**
 * Deterministic product-batch -> UI converter. Mirrors
 * {@link clarificationResultToQuestionUpdates}: a pure function from typed
 * workflow state to wire UiUpdates, with no LLM call. The invariants the
 * retired `validateProductPresentation` checked (one ProductGrid rooted at
 * batch.gridRoot, one ProductCard per product, exact id/title/description/
 * imagePrompt match, no extra fields) hold by construction.
 */
export function productBatchToUiUpdate(batch: ProductBatch): UiSpecUpdate {
  const productIds = batch.products.map((product) => product.id);
  const grid: ComponentInstance = {
    id: batch.gridRoot,
    component: "ProductGrid",
    children: productIds,
  };
  const cards: ComponentInstance[] = batch.products.map((product) => {
    const card: ComponentInstance & Record<string, unknown> = {
      id: product.id,
      component: "ProductCard",
      title: product.title,
      description: product.description,
    };
    if (typeof product.imagePrompt === "string") card.imagePrompt = product.imagePrompt;
    return card as ComponentInstance;
  });
  return {
    type: "ui",
    rootId: batch.gridRoot,
    components: [grid, ...cards],
  };
}

/**
 * Wrap a product UI update as a single-element `ModelUiOutput.updates` array.
 * Convenience for callers that need to emit the batch as a complete output
 * payload (e.g. when draining pending UI from workflow state).
 */
export function productBatchToModelUiUpdates(batch: ProductBatch): UiUpdate[] {
  return [productBatchToUiUpdate(batch)];
}
