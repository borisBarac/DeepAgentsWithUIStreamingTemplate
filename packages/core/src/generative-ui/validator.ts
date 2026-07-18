import Ajv2020, { type JSONSchemaType, type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";

import { catalog, catalogLimits, envelopeSchemaDoc, getComponentSchema } from "./catalog.ts";
import type {
  A2UIComponentValidationResult,
  A2UIValidationError,
  A2UIValidationResult,
} from "./errors.ts";
import type { ComponentInstance, ModelUiOutput, UiSpec, UiUpdate } from "./types.ts";
import { isCatalogUri } from "./uri.ts";

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  strictSchema: false,
  allowUnionTypes: true,
});
addFormats(ajv);
ajv.addFormat("uri", isCatalogUri);

// Pass 1: catalog-agnostic envelope. Rejects malformed updates regardless of
// the per-component catalog.
const envelopeValidators = compileEnvelopeValidators();

function compileEnvelopeValidators(): {
  componentInstance: ValidateFunction;
  uiUpdate: ValidateFunction;
  modelUiOutput: ValidateFunction;
  uiSpec: ValidateFunction;
} {
  const defs = (envelopeSchemaDoc as { $defs?: Record<string, unknown> }).$defs ?? {};
  const uiUpdateSchema = {
    $id: "https://deep-agent-template/core/schemas/envelope.ui-update.json",
    $defs: defs,
    $ref: "#/$defs/UiUpdate",
  } as unknown as JSONSchemaType<UiUpdate>;
  const componentInstanceSchema = {
    $id: "https://deep-agent-template/core/schemas/envelope.component-instance.json",
    $defs: defs,
    $ref: "#/$defs/ComponentInstance",
  } as unknown as JSONSchemaType<ComponentInstance>;
  const modelUiOutputSchema = {
    $id: "https://deep-agent-template/core/schemas/envelope.model-output.json",
    $defs: defs,
    $ref: "#/$defs/ModelUiOutput",
  } as unknown as JSONSchemaType<ModelUiOutput>;
  const uiSpecSchema = {
    $id: "https://deep-agent-template/core/schemas/envelope.ui-spec.json",
    $defs: defs,
    $ref: "#/$defs/UiSpec",
  } as unknown as JSONSchemaType<UiSpec>;

  return {
    componentInstance: ajv.compile(componentInstanceSchema),
    uiUpdate: ajv.compile(uiUpdateSchema),
    modelUiOutput: ajv.compile(modelUiOutputSchema),
    uiSpec: ajv.compile(uiSpecSchema),
  };
}

// Pass 2: per-component validators, compiled once per catalog entry at module
// load. Catalog name -> compiled JSON Schema validator.
const componentValidators = compileComponentValidators();

function compileComponentValidators(): Map<string, ValidateFunction> {
  const defs = (catalog as unknown as { $defs?: Record<string, unknown> }).$defs ?? {};
  const map = new Map<string, ValidateFunction>();
  for (const name of Object.keys(catalog.components)) {
    const schema = getComponentSchema(name);
    if (!schema) continue;
    const bundled = {
      ...schema,
      $defs: defs,
    } as unknown as JSONSchemaType<Record<string, unknown>>;
    map.set(name, ajv.compile(bundled));
  }
  return map;
}

/**
 * Pre-flight: rejects payloads that can't be JSON-serialized or that blow the
 * byte budget. Both sides of the wire share this guard so the model can't
 * OOM the validator with a 10MB blob.
 */
function checkPayload(value: unknown): A2UIValidationError | null {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return {
      path: "$",
      code: "invalid_payload",
      message: "UI update must be JSON serializable.",
    };
  }
  if (serialized === undefined) {
    return {
      path: "$",
      code: "invalid_payload",
      message: "UI update must be JSON serializable.",
    };
  }
  const byteLength = new TextEncoder().encode(serialized).byteLength;
  if (byteLength > catalogLimits.maxJsonBytes) {
    return {
      path: "$",
      code: "payload_too_large",
      message: `UI update must not exceed ${catalogLimits.maxJsonBytes} bytes.`,
    };
  }
  return null;
}

/**
 * Walks every string in the payload looking for one that exceeds the catalog's
 * maxStringLength. Hand-rolled because ajv's maxLength only checks known
 * schema fields, not free-form extras.
 */
function findOversizedString(value: unknown, path = "$"): A2UIValidationError | null {
  if (typeof value === "string") {
    return [...value].length > catalogLimits.maxStringLength
      ? {
          path,
          code: "string_too_long",
          message: `Strings must not exceed ${catalogLimits.maxStringLength} characters.`,
        }
      : null;
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const issue = findOversizedString(item, `${path}[${index}]`);
      if (issue) return issue;
    }
    return null;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const issue = findOversizedString(item, path === "$" ? key : `${path}.${key}`);
      if (issue) return issue;
    }
  }
  return null;
}

function ajvErrorsToIssues(
  errors: { instancePath: string; schemaPath: string; message?: string }[] | undefined | null,
  pathPrefix = "$",
): A2UIValidationError[] {
  if (!errors || errors.length === 0) {
    return [
      {
        path: pathPrefix,
        code: "invalid_envelope",
        message: "Value did not match the expected schema.",
      },
    ];
  }
  return errors.slice(0, 10).map((err) => {
    const instancePath = err.instancePath
      ? `.${err.instancePath.replace(/^\//, "").replace(/\//g, ".")}`
      : "";
    return {
      path: `${pathPrefix}${instancePath}`,
      code: "invalid_envelope",
      message: err.message ?? "Value did not match the expected schema.",
    };
  });
}

/**
 * Adjacency pass. Verifies the per-instance graph is well-formed: unique ids,
 * every child ref resolves, no cycles (DFS tri-color), every node reachable
 * from rootId. The legacy validator produced the same diagnostics; we keep
 * the codes so the repair loop's feedback text is unchanged.
 */
function checkAdjacency(spec: UiSpec): A2UIValidationError[] {
  const issues: A2UIValidationError[] = [];

  if (spec.components.length === 0) {
    issues.push({
      path: "components",
      code: "empty_components",
      message: "UI spec must contain at least one component instance.",
    });
    return issues;
  }
  if (spec.components.length > catalogLimits.maxComponents) {
    issues.push({
      path: "components",
      code: "too_many_components",
      message: `UI spec must not contain more than ${catalogLimits.maxComponents} component instances.`,
    });
    return issues;
  }

  const byId = new Map<string, ComponentInstance>();
  for (const [index, instance] of spec.components.entries()) {
    if (byId.has(instance.id)) {
      issues.push({
        path: `components[${index}].id`,
        code: "duplicate_id",
        message: `Component id "${instance.id}" is used more than once.`,
      });
    } else {
      byId.set(instance.id, instance);
    }
  }
  if (issues.length > 0) return issues;

  const rootId = spec.rootId ?? spec.components[0]?.id;
  if (rootId && !byId.has(rootId)) {
    issues.push({
      path: "rootId",
      code: "missing_root_element",
      message: `Root component "${rootId}" is not present in components.`,
    });
    return issues;
  }

  for (const [index, instance] of spec.components.entries()) {
    for (const child of instance.children ?? []) {
      if (!byId.has(child)) {
        issues.push({
          path: `components[${index}].children`,
          code: "missing_child",
          message: `Child "${child}" is not defined in components.`,
        });
      } else if (child === instance.id) {
        issues.push({
          path: `components[${index}].children`,
          code: "self_reference",
          message: `Component "${instance.id}" cannot reference itself as a child.`,
        });
      }
    }
  }
  if (issues.length > 0) return issues;

  // Tri-color DFS for cycle detection. WHITE=unvisited, GRAY=on stack, BLACK=done.
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const id of byId.keys()) color.set(id, WHITE);

  let cycle: A2UIValidationError | null = null;
  const visit = (id: string, path: string): void => {
    if (cycle) return;
    const state = color.get(id);
    if (state === BLACK) return;
    if (state === GRAY) {
      cycle = {
        path,
        code: "cyclic_reference",
        message: `Component "${id}" participates in a cycle in the children graph.`,
      };
      return;
    }
    color.set(id, GRAY);
    const instance = byId.get(id);
    const children = instance?.children ?? [];
    for (const [i, child] of children.entries()) {
      visit(child, `${path}.children[${i}]`);
      if (cycle) return;
    }
    color.set(id, BLACK);
  };

  if (rootId) {
    visit(rootId, "rootId");
  } else {
    for (const id of byId.keys()) {
      if (color.get(id) === WHITE) visit(id, `components`);
      if (cycle) break;
    }
  }
  if (cycle) {
    issues.push(cycle);
    return issues;
  }

  // Reachability: every component should be reachable from rootId.
  if (rootId) {
    const reachable = new Set<string>();
    const stack = [rootId];
    while (stack.length > 0) {
      const id = stack.pop();
      if (!id || reachable.has(id)) continue;
      reachable.add(id);
      const instance = byId.get(id);
      if (instance?.children) stack.push(...instance.children);
    }
    for (const [index, instance] of spec.components.entries()) {
      if (!reachable.has(instance.id)) {
        issues.push({
          path: `components.${instance.id}`,
          code: "unreachable_element",
          message: `Component "${instance.id}" (index ${index}) is not reachable from root "${rootId}".`,
        });
      }
    }
  }

  return issues;
}

/**
 * The single entry point for the A2UI v2 validator. Runs the three passes in
 * order and returns either the accepted update or a structured issue list.
 *
 * Pass 1 — envelope shape (catalog-agnostic, ajv).
 * Pass 2 — per-component props (catalog-driven, ajv, one compiled validator per component).
 * Pass 3 — adjacency integrity (hand-rolled DFS).
 */
export function validateUpdate(value: unknown): A2UIValidationResult {
  const payloadIssue = checkPayload(value);
  if (payloadIssue) return { ok: false, issues: [payloadIssue] };

  const stringIssue = findOversizedString(value);
  if (stringIssue) return { ok: false, issues: [stringIssue] };

  if (!envelopeValidators.uiUpdate(value)) {
    return {
      ok: false,
      issues: ajvErrorsToIssues(envelopeValidators.uiUpdate.errors ?? []),
    };
  }

  const update = value as UiUpdate;
  if (update.type !== "ui") {
    return { ok: true, update };
  }

  const componentIssues: A2UIValidationError[] = [];
  for (const [index, rawInstance] of update.components.entries()) {
    const result = validateComponentInstance(rawInstance);
    if (!result.ok) {
      for (const issue of result.issues) {
        componentIssues.push({
          ...issue,
          path: issue.path === "$" ? `components[${index}]` : `components[${index}].${issue.path}`,
        });
      }
    }
  }
  if (componentIssues.length > 0) return { ok: false, issues: componentIssues };

  const adjacencyIssues = checkAdjacency({
    components: update.components,
    rootId: update.rootId,
  });
  if (adjacencyIssues.length > 0) return { ok: false, issues: adjacencyIssues };

  return { ok: true, update };
}

/**
 * Validates one ComponentInstance against the catalog. The envelope-level id
 * and component checks have already passed by the time this runs; this is
 * purely the per-component props check.
 */
export function validateComponentInstance(instance: unknown): A2UIComponentValidationResult {
  const payloadIssue = checkPayload(instance);
  if (payloadIssue) return { ok: false, issues: [payloadIssue] };

  const stringIssue = findOversizedString(instance);
  if (stringIssue) return { ok: false, issues: [stringIssue] };

  if (!envelopeValidators.componentInstance(instance)) {
    return {
      ok: false,
      issues: ajvErrorsToIssues(envelopeValidators.componentInstance.errors ?? []),
    };
  }
  const record = instance as unknown as Record<string, unknown>;
  const name = record.component;
  if (typeof name !== "string") {
    return {
      ok: false,
      issues: [
        {
          path: "component",
          code: "unknown_component",
          message: "Component name must be a string.",
        },
      ],
    };
  }

  const validator = componentValidators.get(name);
  if (!validator) {
    return {
      ok: false,
      issues: [
        {
          path: "component",
          code: "unknown_component",
          message: `Component "${name}" is not in the catalog.`,
        },
      ],
    };
  }

  const props: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === "id" || key === "component" || key === "children") continue;
    props[key] = value;
  }

  if (!validator(props)) {
    return {
      ok: false,
      issues: ajvErrorsToIssues(validator.errors ?? [], "props"),
    };
  }

  return { ok: true, instance: record as unknown as ComponentInstance };
}

/**
 * Validates a full ModelUiOutput (the versioned object the model returns via
 * `withStructuredOutput`). Runs envelope + per-component + adjacency for every
 * `type: "ui"` update in the batch.
 */
export function validateModelUiOutput(
  value: unknown,
): { ok: true; output: ModelUiOutput } | { ok: false; issues: A2UIValidationError[] } {
  const payloadIssue = checkPayload(value);
  if (payloadIssue) return { ok: false, issues: [payloadIssue] };

  if (!envelopeValidators.modelUiOutput(value)) {
    return {
      ok: false,
      issues: ajvErrorsToIssues(envelopeValidators.modelUiOutput.errors ?? []),
    };
  }

  const output = value as ModelUiOutput;
  for (const [updateIndex, update] of output.updates.entries()) {
    if (update.type !== "ui") continue;
    const result = validateUpdate(update);
    if (!result.ok) {
      return {
        ok: false,
        issues: result.issues.map((issue) => ({
          ...issue,
          path: `updates[${updateIndex}].${issue.path}`,
        })),
      };
    }
  }
  return { ok: true, output };
}
