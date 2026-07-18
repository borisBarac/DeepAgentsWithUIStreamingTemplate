import type { JSONSchemaType } from "ajv";
import catalogJson from "../../catalog/catalog.json" with { type: "json" };
import envelopeJson from "../../schemas/envelope.json" with { type: "json" };

/**
 * The on-disk catalog document. Each component maps to a JSON Schema that
 * describes its props. Limits are shared with the client mini-validator so
 * both sides agree on what counts as "too big".
 */
export type CatalogDoc = {
  version: 1;
  limits: {
    maxComponents: number;
    maxStringLength: number;
    maxJsonBytes: number;
  };
  components: Record<string, JSONSchemaType<Record<string, unknown>>>;
};

const loadedCatalog = catalogJson as unknown as CatalogDoc;

export const catalog: CatalogDoc = loadedCatalog;

export const catalogLimits = loadedCatalog.limits;

export const catalogComponentNames: readonly string[] = Object.freeze(
  Object.keys(loadedCatalog.components),
);

export const catalogVersion: 1 = loadedCatalog.version;

/**
 * The catalog-agnostic envelope JSON Schema (unparsed). The validator compiles
 * this with ajv; consumers that want to inspect the raw doc (e.g. to render
 * documentation) can import this directly.
 */
export const envelopeSchemaDoc = envelopeJson;

/**
 * Look up a component's JSON Schema by name. Returns `undefined` when the name
 * is not in the catalog — callers should treat that as a validation failure.
 */
export function getComponentSchema(
  name: string,
): JSONSchemaType<Record<string, unknown>> | undefined {
  return loadedCatalog.components[name];
}

export function isKnownComponent(name: string): boolean {
  return Object.hasOwn(loadedCatalog.components, name);
}
