import { catalog, catalogLimits } from "@deep-agent-template/core/generative-ui/catalog";
import { envelopeSchema } from "@deep-agent-template/core/generative-ui/schema";
import type {
  A2UIValidationError,
  A2UIValidationResult,
  ComponentInstance,
  ModelUiOutput,
  UiUpdate,
} from "@deep-agent-template/core/generative-ui/types";

import { assertSupportedJsonSchema, matchesJsonSchema } from "./json-schema.ts";

const envelopeSchemaRoot = envelopeSchema as unknown as Record<string, unknown>;
const uiUpdateSchema = { $ref: "#/$defs/UiUpdate" };
const modelUiOutputSchema = { $ref: "#/$defs/ModelUiOutput" };

assertSupportedJsonSchema(envelopeSchemaRoot);
for (const schema of Object.values(catalog.components)) {
  assertSupportedJsonSchema(schema as unknown as Record<string, unknown>);
}

function issue(
  code: A2UIValidationError["code"],
  path: string,
  message: string,
): { ok: false; issues: A2UIValidationError[] } {
  return { ok: false, issues: [{ code, path, message }] };
}

function findOversizedString(
  value: unknown,
  path = "$",
  seen = new Set<object>(),
): A2UIValidationError | null {
  if (typeof value === "string") {
    return [...value].length > catalogLimits.maxStringLength
      ? {
          code: "string_too_long",
          path,
          message: `Strings must not exceed ${catalogLimits.maxStringLength} characters.`,
        }
      : null;
  }
  if (value === null || typeof value !== "object" || seen.has(value)) return null;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    const childPath = Array.isArray(value)
      ? `${path}[${key}]`
      : path === "$"
        ? key
        : `${path}.${key}`;
    const found = findOversizedString(child, childPath, seen);
    if (found) return found;
  }
  return null;
}

function validateEnvelope(value: unknown): value is UiUpdate {
  return matchesJsonSchema(value, uiUpdateSchema, envelopeSchemaRoot);
}

function validateComponent(instance: ComponentInstance, index: number): A2UIValidationError | null {
  const schema = catalog.components[instance.component] as unknown as
    | Record<string, unknown>
    | undefined;
  if (!schema) {
    return {
      code: "unknown_component",
      path: `components[${index}].component`,
      message: `Component "${instance.component}" is not in the catalog.`,
    };
  }
  const props = Object.fromEntries(
    Object.entries(instance).filter(
      ([key]) => key !== "id" && key !== "component" && key !== "children",
    ),
  );
  return matchesJsonSchema(props, schema, schema)
    ? null
    : {
        code: "invalid_envelope",
        path: `components[${index}].props`,
        message: `Component "${instance.component}" props did not match the catalog schema.`,
      };
}

function validateGraph(update: Extract<UiUpdate, { type: "ui" }>): A2UIValidationError | null {
  if (update.components.length === 0) {
    return {
      code: "empty_components",
      path: "components",
      message: "UI spec must contain at least one component instance.",
    };
  }
  if (update.components.length > catalogLimits.maxComponents) {
    return {
      code: "too_many_components",
      path: "components",
      message: `UI spec must not contain more than ${catalogLimits.maxComponents} component instances.`,
    };
  }
  const byId = new Map<string, ComponentInstance>();
  for (const [index, component] of update.components.entries()) {
    if (byId.has(component.id)) {
      return {
        code: "duplicate_id",
        path: `components[${index}].id`,
        message: `Component id "${component.id}" is used more than once.`,
      };
    }
    byId.set(component.id, component);
  }
  const rootId = update.rootId ?? update.components[0]?.id;
  if (rootId && !byId.has(rootId)) {
    return {
      code: "missing_root_element",
      path: "rootId",
      message: `Root component "${rootId}" is not present in components.`,
    };
  }
  for (const [index, component] of update.components.entries()) {
    for (const child of component.children ?? []) {
      if (!byId.has(child)) {
        return {
          code: "missing_child",
          path: `components[${index}].children`,
          message: `Child "${child}" is not defined in components.`,
        };
      }
      if (child === component.id) {
        return {
          code: "self_reference",
          path: `components[${index}].children`,
          message: `Component "${component.id}" cannot reference itself as a child.`,
        };
      }
    }
  }
  const colors = new Map<string, number>();
  const visit = (id: string): boolean => {
    const color = colors.get(id) ?? 0;
    if (color === 1) return true;
    if (color === 2) return false;
    colors.set(id, 1);
    if ((byId.get(id)?.children ?? []).some(visit)) return true;
    colors.set(id, 2);
    return false;
  };
  if (rootId && visit(rootId)) {
    return {
      code: "cyclic_reference",
      path: "rootId",
      message: `Component "${rootId}" participates in a cycle in the children graph.`,
    };
  }
  if (rootId) {
    const reachable = new Set<string>();
    const stack = [rootId];
    while (stack.length > 0) {
      const id = stack.pop();
      if (!id || reachable.has(id)) continue;
      reachable.add(id);
      stack.push(...(byId.get(id)?.children ?? []));
    }
    const unreachable = update.components.find((component) => !reachable.has(component.id));
    if (unreachable) {
      return {
        code: "unreachable_element",
        path: `components.${unreachable.id}`,
        message: `Component "${unreachable.id}" is not reachable from root "${rootId}".`,
      };
    }
  }
  return null;
}

export function validateClientUpdate(value: unknown): A2UIValidationResult {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return issue("invalid_payload", "$", "UI update must be JSON serializable.");
  }
  if (serialized === undefined) {
    return issue("invalid_payload", "$", "UI update must be JSON serializable.");
  }
  if (new TextEncoder().encode(serialized).byteLength > catalogLimits.maxJsonBytes) {
    return issue(
      "payload_too_large",
      "$",
      `UI update must not exceed ${catalogLimits.maxJsonBytes} bytes.`,
    );
  }
  const stringIssue = findOversizedString(value);
  if (stringIssue) return { ok: false, issues: [stringIssue] };
  if (!validateEnvelope(value)) {
    return issue("invalid_envelope", "$", "Value did not match the expected update envelope.");
  }
  if (value.type !== "ui") return { ok: true, update: value };
  for (const [index, component] of value.components.entries()) {
    const componentIssue = validateComponent(component, index);
    if (componentIssue) return { ok: false, issues: [componentIssue] };
  }
  const graphIssue = validateGraph(value);
  return graphIssue ? { ok: false, issues: [graphIssue] } : { ok: true, update: value };
}

export type ClientModelUiOutputValidationResult =
  | { ok: true; output: ModelUiOutput }
  | { ok: false; issues: A2UIValidationError[] };

export function validateClientModelUiOutput(value: unknown): ClientModelUiOutputValidationResult {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return issue("invalid_payload", "$", "UI output must be JSON serializable.");
  }
  if (serialized === undefined) {
    return issue("invalid_payload", "$", "UI output must be JSON serializable.");
  }
  if (new TextEncoder().encode(serialized).byteLength > catalogLimits.maxJsonBytes) {
    return issue(
      "payload_too_large",
      "$",
      `UI output must not exceed ${catalogLimits.maxJsonBytes} bytes.`,
    );
  }
  const stringIssue = findOversizedString(value);
  if (stringIssue) return { ok: false, issues: [stringIssue] };
  if (!matchesJsonSchema(value, modelUiOutputSchema, envelopeSchemaRoot)) {
    return issue("invalid_model_output", "$", "Value did not match the model output schema.");
  }
  const output = value as ModelUiOutput;
  for (const [index, update] of output.updates.entries()) {
    const result = validateClientUpdate(update);
    if (!result.ok) {
      return {
        ok: false,
        issues: result.issues.map((validationIssue) => ({
          ...validationIssue,
          path: `updates[${index}].${validationIssue.path}`,
        })),
      };
    }
  }
  return { ok: true, output };
}

export function parseClientUpdateLine(line: string): A2UIValidationResult {
  try {
    return validateClientUpdate(JSON.parse(line));
  } catch {
    return issue("invalid_json", "$", "This line is not valid JSON.");
  }
}
