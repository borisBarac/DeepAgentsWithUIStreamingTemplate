import { type Spec, type UIElement, VisibilityConditionSchema } from "@json-render/core";
import { z } from "zod";
import { CORE_PROMPT_TEMPLATES, renderPromptTemplate } from "../prompts/index.ts";
import type { SpecValidationIssue, SpecValidationResult } from "./envelope.ts";
import { productCardSchema as scaffoldProductCardSchema } from "./envelope.ts";

export { productCardSchema } from "./envelope.ts";

export const componentTypes = [
  "Button",
  "Card",
  "ImagePlaceholder",
  "ProductCard",
  "ProductGrid",
  "Stack",
  "Text",
  "TextInput",
  "product-card",
] as const;

export type ComponentTypeName = (typeof componentTypes)[number];

export const MAX_SPEC_ELEMENTS = 100;
export const MAX_SPEC_STRING_LENGTH = 4_096;
export const MAX_SPEC_JSON_BYTES = 128 * 1_024;

export const cardPropsSchema = z.object({
  title: z.string().optional(),
});

export const stackPropsSchema = z.object({
  direction: z.enum(["row", "column"]).optional(),
  gap: z.enum(["xs", "sm", "md", "lg"]).optional(),
});

export const textPropsSchema = z.object({
  text: z.string(),
  variant: z.enum(["title", "body", "muted", "caption"]).optional(),
});

export const textInputPropsSchema = z.object({
  label: z.string(),
  name: z.string(),
  placeholder: z.string().optional(),
  inputType: z.enum(["text", "email", "password"]).optional(),
});

export const buttonPropsSchema = z.object({
  label: z.string(),
  action: z.string().optional(),
});

export const productGridPropsSchema = z.object({
  heading: z.string().optional(),
});

export const productCardPropsSchema = z.object({
  title: z.string(),
  description: z.string(),
  imageAlt: z.string().optional(),
  imagePrompt: z.string().optional(),
});

export const imagePlaceholderPropsSchema = z.object({
  alt: z.string().optional(),
  prompt: z.string().optional(),
});

export const componentPropsSchemas = {
  Button: buttonPropsSchema,
  Card: cardPropsSchema,
  ImagePlaceholder: imagePlaceholderPropsSchema,
  ProductCard: productCardPropsSchema,
  ProductGrid: productGridPropsSchema,
  Stack: stackPropsSchema,
  Text: textPropsSchema,
  TextInput: textInputPropsSchema,
  "product-card": scaffoldProductCardSchema,
} satisfies Record<ComponentTypeName, z.ZodObject>;

const componentTypeUnion = componentTypes.map((type) => JSON.stringify(type)).join(" | ");

type PropDescription = { type: string; optional: boolean };

function describeZodType(schema: z.core.$ZodType): PropDescription {
  if (schema instanceof z.ZodOptional) {
    return { ...describeZodType(schema.unwrap()), optional: true };
  }
  if (schema instanceof z.ZodString) {
    return { type: "string", optional: false };
  }
  if (schema instanceof z.ZodEnum) {
    const options = schema.options as readonly string[];
    return { type: options.map((o) => JSON.stringify(o)).join(" | "), optional: false };
  }
  return { type: "unknown", optional: false };
}

function describePropsSchema(schema: z.ZodObject): string {
  const parts = Object.entries(schema.shape).map(([key, propSchema]) => {
    const { type, optional } = describeZodType(propSchema);
    return optional ? `"${key}"?: ${type}` : `"${key}": ${type}`;
  });
  return `{${parts.join(", ")}}`;
}

const componentPropsCatalog = componentTypes
  .map((type) => `- ${type}: ${describePropsSchema(componentPropsSchemas[type])}`)
  .join("\n");

/**
 * Catalog-specific portion of the generative-UI prompt.
 *
 * This stays core-owned so the agent prompt and the UI contract share the same
 * component list and prop shapes.
 */
export const catalogPrompt = renderPromptTemplate(CORE_PROMPT_TEMPLATES.jsonRenderCatalog, {
  componentPropsCatalog,
  componentTypeUnion,
});

const knownComponentTypes = new Set<string>(componentTypes);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isComponentType(value: unknown): value is ComponentTypeName {
  return typeof value === "string" && knownComponentTypes.has(value);
}

function getPayloadIssue(value: unknown): SpecValidationIssue | null {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return {
      path: "$",
      code: "invalid_payload",
      message: "Spec must be JSON serializable.",
    };
  }

  if (serialized === undefined) {
    return {
      path: "$",
      code: "invalid_payload",
      message: "Spec must be JSON serializable.",
    };
  }

  const byteLength = new TextEncoder().encode(serialized).byteLength;
  if (byteLength > MAX_SPEC_JSON_BYTES) {
    return {
      path: "$",
      code: "payload_too_large",
      message: `Spec must not exceed ${MAX_SPEC_JSON_BYTES} bytes.`,
    };
  }

  return null;
}

function findOversizedString(value: unknown, path = "$"): SpecValidationIssue | null {
  if (typeof value === "string") {
    return value.length > MAX_SPEC_STRING_LENGTH
      ? {
          path,
          code: "string_too_long",
          message: `Strings must not exceed ${MAX_SPEC_STRING_LENGTH} characters.`,
        }
      : null;
  }

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const issue = findOversizedString(item, `${path}.${index}`);
      if (issue) {
        return issue;
      }
    }
    return null;
  }

  if (!isRecord(value)) {
    return null;
  }

  for (const [key, item] of Object.entries(value)) {
    if (key.length > MAX_SPEC_STRING_LENGTH) {
      return {
        path,
        code: "string_too_long",
        message: `Object keys must not exceed ${MAX_SPEC_STRING_LENGTH} characters.`,
      };
    }
    const itemPath = path === "$" ? key : `${path}.${key}`;
    const issue = findOversizedString(item, itemPath);
    if (issue) {
      return issue;
    }
  }

  return null;
}

function normalizeElement(value: unknown): UIElement | null {
  if (!isRecord(value)) {
    return null;
  }

  const type = value.type;
  if (!isComponentType(type)) {
    return null;
  }

  if (!isRecord(value.props)) {
    return null;
  }

  const rawChildren = value.children ?? [];
  if (!Array.isArray(rawChildren) || rawChildren.some((child) => typeof child !== "string")) {
    return null;
  }

  const parsedProps = componentPropsSchemas[type].safeParse(value.props);
  if (!parsedProps.success) {
    return null;
  }

  const parsedVisible =
    value.visible === undefined ? null : VisibilityConditionSchema.safeParse(value.visible);
  if (parsedVisible && !parsedVisible.success) {
    return null;
  }

  return {
    type,
    props: parsedProps.data,
    children: rawChildren,
    ...(parsedVisible ? { visible: parsedVisible.data } : {}),
  };
}

function diagnoseElement(key: string, value: unknown): SpecValidationIssue[] {
  if (!isRecord(value)) {
    return [
      {
        path: `elements.${key}`,
        code: "invalid_element",
        message: `Element "${key}" must be an object.`,
      },
    ];
  }

  const type = value.type;
  if (!isComponentType(type)) {
    return [
      {
        path: `elements.${key}.type`,
        code: "unknown_component",
        message: `Component type "${String(type)}" is not in the catalog.`,
      },
    ];
  }

  if (!isRecord(value.props)) {
    return [
      {
        path: `elements.${key}.props`,
        code: "missing_props",
        message: `Element "${key}" must include a props object.`,
      },
    ];
  }

  const parsed = componentPropsSchemas[type].safeParse(value.props);
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => ({
      path: `elements.${key}.props.${issue.path.join(".")}`,
      code: issue.code,
      message: issue.message,
    }));
  }

  const rawChildren = value.children ?? [];
  if (!Array.isArray(rawChildren) || rawChildren.some((child) => typeof child !== "string")) {
    return [
      {
        path: `elements.${key}.children`,
        code: "invalid_children",
        message: `Element "${key}" children must be an array of strings.`,
      },
    ];
  }

  if (value.visible !== undefined && !VisibilityConditionSchema.safeParse(value.visible).success) {
    return [
      {
        path: `elements.${key}.visible`,
        code: "invalid_visibility",
        message: `Element "${key}" has an invalid visibility condition.`,
      },
    ];
  }

  return [
    {
      path: `elements.${key}`,
      code: "invalid_element",
      message: `Element "${key}" could not be normalized.`,
    },
  ];
}

/**
 * Validates a streamed spec against the component catalog, returning either a
 * normalized spec or structured, path-specific issues.
 *
 * Diagnostics include the JSON path (e.g. `elements.card.props.title`), a code,
 * and a human-readable message, so a repair pass can tell the agent exactly what
 * to fix.
 */
export function validateStreamingSpec(value: unknown): SpecValidationResult {
  const payloadIssue = getPayloadIssue(value);
  if (payloadIssue) {
    return { ok: false, issues: [payloadIssue] };
  }

  const stringIssue = findOversizedString(value);
  if (stringIssue) {
    return { ok: false, issues: [stringIssue] };
  }

  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [{ path: "$", code: "invalid_type", message: "Spec must be an object." }],
    };
  }
  if (typeof value.root !== "string" || value.root === "") {
    return {
      ok: false,
      issues: [
        {
          path: "root",
          code: "missing_root",
          message: "Spec must include a non-empty string 'root'.",
        },
      ],
    };
  }
  if (!isRecord(value.elements)) {
    return {
      ok: false,
      issues: [
        {
          path: "elements",
          code: "missing_elements",
          message: "Spec must include an 'elements' object.",
        },
      ],
    };
  }
  const elementCount = Object.keys(value.elements).length;
  if (elementCount > MAX_SPEC_ELEMENTS) {
    return {
      ok: false,
      issues: [
        {
          path: "elements",
          code: "too_many_elements",
          message: `Spec must not contain more than ${MAX_SPEC_ELEMENTS} elements.`,
        },
      ],
    };
  }
  if (!Object.hasOwn(value.elements, value.root)) {
    return {
      ok: false,
      issues: [
        {
          path: "root",
          code: "missing_root_element",
          message: `Root element "${value.root}" is not defined in elements.`,
        },
      ],
    };
  }

  const normalizedElements: Array<[string, UIElement]> = [];
  const issues: SpecValidationIssue[] = [];

  for (const [key, elementValue] of Object.entries(value.elements)) {
    const normalized = normalizeElement(elementValue);
    if (normalized) {
      normalizedElements.push([key, normalized]);
    } else {
      issues.push(...diagnoseElement(key, elementValue));
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const elements: Spec["elements"] = Object.fromEntries(normalizedElements);

  for (const [key, element] of Object.entries(elements)) {
    for (const child of element.children ?? []) {
      if (!Object.hasOwn(elements, child)) {
        return {
          ok: false,
          issues: [
            {
              path: `elements.${key}.children`,
              code: "missing_child",
              message: `Child "${child}" is not defined in elements.`,
            },
          ],
        };
      }
      if (child === key) {
        return {
          ok: false,
          issues: [
            {
              path: `elements.${key}.children`,
              code: "self_reference",
              message: `Element "${key}" cannot reference itself as a child.`,
            },
          ],
        };
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  let cycleIssue: SpecValidationIssue | null = null;
  const visit = (key: string): void => {
    if (cycleIssue || visited.has(key)) {
      return;
    }
    visiting.add(key);
    for (const child of elements[key]?.children ?? []) {
      if (visiting.has(child)) {
        cycleIssue = {
          path: `elements.${key}.children`,
          code: "cyclic_reference",
          message: `Child "${child}" creates a cycle in the element graph.`,
        };
        return;
      }
      visit(child);
    }
    visiting.delete(key);
    visited.add(key);
  };

  for (const key of Object.keys(elements)) {
    visit(key);
    if (cycleIssue) {
      return { ok: false, issues: [cycleIssue] };
    }
  }

  const reachable = new Set<string>();
  const pending = [value.root];
  while (pending.length > 0) {
    const key = pending.pop();
    if (!key || reachable.has(key)) {
      continue;
    }
    reachable.add(key);
    pending.push(...(elements[key]?.children ?? []));
  }

  const unreachableIssues = Object.keys(elements).flatMap((key): SpecValidationIssue[] =>
    reachable.has(key)
      ? []
      : [
          {
            path: `elements.${key}`,
            code: "unreachable_element",
            message: `Element "${key}" is not reachable from root "${value.root}".`,
          },
        ],
  );
  if (unreachableIssues.length > 0) {
    return { ok: false, issues: unreachableIssues };
  }

  return { ok: true, spec: { root: value.root, elements } };
}

export function normalizeStreamingSpec(value: unknown): Spec | null {
  const result = validateStreamingSpec(value);
  return result.ok ? result.spec : null;
}
