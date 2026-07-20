import { type ComponentInstance, normalizeModelUiOutput } from "../generative-ui/index.ts";

export type ProductMode = "create" | "update";

export type ProductItem = {
  id: string;
  title: string;
  description: string;
  imagePrompt?: string;
};

export type ProductBatch = {
  mode: ProductMode;
  gridRoot: string;
  products: ProductItem[];
};

export type ExistingProductSet = {
  gridRoot: string;
  products: ProductItem[];
};

function messageText(message: unknown): string {
  if (typeof message !== "object" || message === null || !("content" in message)) return "";
  if ("role" in message && message.role !== "assistant") return "";
  if ("type" in message && message.type !== "ai" && message.type !== "assistant") return "";
  return typeof message.content === "string" ? message.content : "";
}

function productFromComponent(component: ComponentInstance): ProductItem | null {
  if (component.component !== "ProductCard") return null;
  if (typeof component.title !== "string" || typeof component.description !== "string") return null;
  return {
    id: component.id,
    title: component.title,
    description: component.description,
    ...(typeof component.imagePrompt === "string" ? { imagePrompt: component.imagePrompt } : {}),
  };
}

export function extractLatestProductSet(history: readonly unknown[]): ExistingProductSet | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const text = messageText(history[index]);
    if (!text) continue;
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      continue;
    }
    const output = normalizeModelUiOutput(value);
    if (!output) continue;
    for (let updateIndex = output.updates.length - 1; updateIndex >= 0; updateIndex -= 1) {
      const update = output.updates[updateIndex];
      if (update?.type !== "ui") continue;
      const products = update.components.flatMap((component) => {
        const product = productFromComponent(component);
        return product ? [product] : [];
      });
      if (products.length === 0) continue;
      const grid = update.components.find((component) => component.component === "ProductGrid");
      return { gridRoot: grid?.id ?? "products", products };
    }
  }
  return null;
}

export function requestedProductCount(request: string): number | null {
  const match = request.match(
    /\b(?:make|show|create|generate|give|with|to)?\s*(\d{1,2})\s+(?:new\s+)?products?\b/i,
  );
  const words: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
  };
  const wordMatch = request.match(
    /\b(?:make|show|create|generate|give|with|to)?\s*(one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:new\s+)?products?\b/i,
  );
  const count = match?.[1] ? Number(match[1]) : words[wordMatch?.[1]?.toLowerCase() ?? ""];
  if (count === undefined) return null;
  return Number.isInteger(count) && count > 0 ? count : null;
}

export function productContext(
  history: readonly unknown[],
  request: string,
  productGenerationEnabled = true,
) {
  const existingProducts = extractLatestProductSet(history);
  return {
    existingProducts,
    productMode: existingProducts ? ("update" as const) : ("create" as const),
    targetProductCount: requestedProductCount(request) ?? (existingProducts?.products.length || 3),
    productGenerationEnabled,
  };
}
