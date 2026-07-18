import { CORE_PROMPT_TEMPLATES } from "../prompts/index.ts";
import { catalog, catalogComponentNames } from "./catalog.ts";

/**
 * Single source of truth for the model-facing component-prop description.
 *
 * Walks catalog.json and emits text in the exact shape the legacy
 * `describeZodType` walker produced:
 *
 *   `{"requiredKey": string, "optionalKey"?: "a" | "b"}`
 *
 * A byte-for-byte parity test pins this output, so changing the catalog
 * (adding/removing props, retyping, reordering) takes effect across both the
 * prompt and the validator with no other code changes.
 */

type JsonSchemaProp = {
  type?: string;
  enum?: unknown[];
  format?: string;
  const?: unknown;
  oneOf?: unknown[];
  anyOf?: unknown[];
};

type JsonSchemaComponent = {
  type?: string;
  properties?: Record<string, JsonSchemaProp>;
  required?: string[];
  additionalProperties?: boolean;
};

function describePropType(prop: JsonSchemaProp): string {
  if (Array.isArray(prop.enum)) {
    return prop.enum.map((v) => JSON.stringify(v)).join(" | ");
  }
  // Future: const, oneOf, anyOf could be handled here. Today's catalog uses
  // only string + enum, so we keep the walker narrow and predictable.
  return "string";
}

function describeComponentProps(schema: JsonSchemaComponent): string {
  const properties = schema.properties ?? {};
  const requiredSet = new Set(schema.required ?? []);
  const parts = Object.entries(properties).map(([key, propSchema]) => {
    const typeText = describePropType(propSchema);
    return requiredSet.has(key) ? `"${key}": ${typeText}` : `"${key}"?: ${typeText}`;
  });
  return `{${parts.join(", ")}}`;
}

/**
 * Returns the `Allowed component props:` block used inside the catalog prompt.
 *
 * Output is a newline-joined list, one entry per component, ordered by
 * catalog.json insertion order (which matches the legacy Zod order).
 */
export function describeCatalogProps(): string {
  return catalogComponentNames
    .map(
      (name) =>
        `- ${name}: ${describeComponentProps(catalog.components[name] as unknown as JsonSchemaComponent)}`,
    )
    .join("\n");
}

/**
 * Returns the TypeScript-style union of component names, e.g.
 * `"Button" | "Card" | ...`. Injected into the prompt template's
 * `{{componentTypeUnion}}` slot.
 */
export function describeComponentTypeUnion(): string {
  return catalogComponentNames.map((name) => JSON.stringify(name)).join(" | ");
}

/**
 * The default prompt fragment produced from the catalog. Callers that want to
 * compose their own prompt can use {@link describeCatalogProps} and
 * {@link describeComponentTypeUnion} directly.
 */
export function catalogPromptFromJsonCatalog(template: string): string {
  return template
    .replaceAll("{{componentPropsCatalog}}", describeCatalogProps())
    .replaceAll("{{componentTypeUnion}}", describeComponentTypeUnion());
}

export const catalogPrompt = catalogPromptFromJsonCatalog(CORE_PROMPT_TEMPLATES.jsonRenderCatalog);
