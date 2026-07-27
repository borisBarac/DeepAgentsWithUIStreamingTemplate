import {
  type A2UIValidationError,
  type ComponentInstance,
  type ModelUiOutput,
  type ModelUiUpdate,
  type ProductBatch,
  validateModelUiOutput,
} from "../src/index.ts";

export type PresentationValidation = {
  ok: boolean;
  output?: ModelUiOutput;
  issues: A2UIValidationError[];
};

/**
 * Validates a presentation output through the production validator and returns
 * the structured issues for diagnostics. Identical to the contract used in
 * generative-ui.e2e.test.ts.
 */
export function validatePresentationOutput(value: unknown): PresentationValidation {
  const result = validateModelUiOutput(value);
  if (result.ok) return { ok: true, output: result.output, issues: [] };
  return { ok: false, issues: result.issues };
}

/**
 * Returns every UI update inside a validated ModelUiOutput. The caller asserts
 * the catalogue contract (root ids, child refs, component names) on the result.
 */
export function extractUiUpdates(output: ModelUiOutput): Extract<ModelUiUpdate, { type: "ui" }>[] {
  return output.updates.filter(
    (update): update is Extract<ModelUiUpdate, { type: "ui" }> => update.type === "ui",
  );
}

export type ProductPresentationComparison = {
  matched: boolean;
  issues: string[];
  cards: ComponentInstance[];
  grid?: ComponentInstance;
};

/**
 * Compares a UI update against an accepted ProductBatch. Mirrors the production
 * invariant in workflow/presentation.ts but returns structured issues so the
 * scenario can include them in its diagnostics.
 */
export function compareProductCards(
  update: Extract<ModelUiUpdate, { type: "ui" }> | undefined,
  batch: ProductBatch,
): ProductPresentationComparison {
  const issues: string[] = [];
  if (!update) {
    return { matched: false, issues: ["No UI update was produced."], cards: [] };
  }
  const grids = update.components.filter((component) => component.component === "ProductGrid");
  const grid = grids[0];
  if (grids.length !== 1) issues.push("Return exactly one ProductGrid.");
  if (!grid || grid.id !== batch.gridRoot || update.rootId !== batch.gridRoot) {
    issues.push(`Use ProductGrid root ${batch.gridRoot}.`);
  }
  const cards = update.components.filter((component) => component.component === "ProductCard");
  if (cards.length !== batch.products.length) {
    issues.push(`Return exactly ${batch.products.length} ProductCard components.`);
  }
  if (
    grid &&
    JSON.stringify(grid.children ?? []) !==
      JSON.stringify(batch.products.map((product) => product.id))
  ) {
    issues.push("ProductGrid children must contain every approved product ID in order.");
  }
  for (const product of batch.products) {
    const card = cards.find((candidate) => candidate.id === product.id);
    if (!card) {
      issues.push(`Missing approved product ${product.id}.`);
      continue;
    }
    if (card.title !== product.title) issues.push(`${product.id} title changed.`);
    if (card.description !== product.description) {
      issues.push(`${product.id} description changed.`);
    }
    if (card.imagePrompt !== product.imagePrompt) {
      issues.push(`${product.id} image prompt changed.`);
    }
  }
  return { matched: issues.length === 0, issues, cards, grid };
}
