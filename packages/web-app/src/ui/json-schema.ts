import { isCatalogUri } from "@deep-agent-template/core/generative-ui/catalog";

type JsonSchema = boolean | Record<string, unknown>;

const supportedKeywords = new Set([
  "$defs",
  "$id",
  "$ref",
  "$schema",
  "additionalProperties",
  "const",
  "description",
  "enum",
  "format",
  "items",
  "maxItems",
  "maxLength",
  "minItems",
  "minLength",
  "oneOf",
  "properties",
  "required",
  "title",
  "type",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function childSchemas(schema: Record<string, unknown>): JsonSchema[] {
  const children: JsonSchema[] = [];
  if (isRecord(schema.$defs)) children.push(...(Object.values(schema.$defs) as JsonSchema[]));
  if (isRecord(schema.properties))
    children.push(...(Object.values(schema.properties) as JsonSchema[]));
  if (Array.isArray(schema.oneOf)) children.push(...(schema.oneOf as JsonSchema[]));
  if (typeof schema.items === "boolean" || isRecord(schema.items)) children.push(schema.items);
  return children;
}

export function assertSupportedJsonSchema(schema: JsonSchema, path = "$schema"): void {
  if (typeof schema === "boolean") return;
  for (const keyword of Object.keys(schema)) {
    if (!supportedKeywords.has(keyword)) {
      throw new Error(`Unsupported JSON Schema keyword "${keyword}" at ${path}.`);
    }
  }
  if (
    schema.type !== undefined &&
    !["array", "boolean", "object", "string"].includes(String(schema.type))
  ) {
    throw new Error(`Unsupported JSON Schema type "${String(schema.type)}" at ${path}.`);
  }
  if (schema.format !== undefined && schema.format !== "uri") {
    throw new Error(`Unsupported JSON Schema format "${String(schema.format)}" at ${path}.`);
  }
  if (schema.$ref !== undefined && !String(schema.$ref).startsWith("#/$defs/")) {
    throw new Error(`Unsupported JSON Schema reference "${String(schema.$ref)}" at ${path}.`);
  }
  for (const [index, child] of childSchemas(schema).entries()) {
    assertSupportedJsonSchema(child, `${path}[${index}]`);
  }
}

function resolveReference(
  reference: string,
  root: Record<string, unknown>,
): JsonSchema | undefined {
  let current: unknown = root;
  for (const segment of reference.slice(2).split("/")) {
    if (!isRecord(current)) return undefined;
    current = current[segment.replaceAll("~1", "/").replaceAll("~0", "~")];
  }
  return typeof current === "boolean" || isRecord(current) ? current : undefined;
}

export function matchesJsonSchema(
  value: unknown,
  schema: JsonSchema,
  root: Record<string, unknown>,
): boolean {
  if (typeof schema === "boolean") return schema;
  if (typeof schema.$ref === "string") {
    const resolved = resolveReference(schema.$ref, root);
    if (!resolved || !matchesJsonSchema(value, resolved, root)) return false;
  }
  if (
    Array.isArray(schema.oneOf) &&
    schema.oneOf.filter((candidate) => matchesJsonSchema(value, candidate as JsonSchema, root))
      .length !== 1
  ) {
    return false;
  }
  if (schema.const !== undefined && !Object.is(value, schema.const)) return false;
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => Object.is(value, item)))
    return false;

  if (schema.type === "string") {
    if (typeof value !== "string") return false;
    const length = [...value].length;
    if (typeof schema.minLength === "number" && length < schema.minLength) return false;
    if (typeof schema.maxLength === "number" && length > schema.maxLength) return false;
    if (schema.format === "uri" && !isCatalogUri(value)) return false;
  }

  if (schema.type === "boolean" && typeof value !== "boolean") return false;

  if (schema.type === "array") {
    if (!Array.isArray(value)) return false;
    if (typeof schema.minItems === "number" && value.length < schema.minItems) return false;
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) return false;
    if (
      schema.items !== undefined &&
      !value.every((item) => matchesJsonSchema(item, schema.items as JsonSchema, root))
    ) {
      return false;
    }
  }

  if (schema.type === "object") {
    if (!isRecord(value)) return false;
    const required = Array.isArray(schema.required) ? schema.required : [];
    if (!required.every((key) => typeof key === "string" && Object.hasOwn(value, key)))
      return false;
    const properties = isRecord(schema.properties) ? schema.properties : {};
    if (
      schema.additionalProperties === false &&
      Object.keys(value).some((key) => !Object.hasOwn(properties, key))
    ) {
      return false;
    }
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (
        Object.hasOwn(value, key) &&
        !matchesJsonSchema(value[key], propertySchema as JsonSchema, root)
      ) {
        return false;
      }
    }
  }

  return true;
}
