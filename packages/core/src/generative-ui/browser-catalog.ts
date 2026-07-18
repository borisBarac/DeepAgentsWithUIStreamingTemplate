import catalogJson from "../../catalog/catalog.json" with { type: "json" };

import type { CatalogDoc } from "./catalog.ts";

export const catalog = catalogJson as unknown as CatalogDoc;
export const catalogLimits = catalog.limits;
export { isCatalogUri } from "./uri.ts";
