import type { Spec, UIElement } from "@json-render/core";
import { z } from "zod";

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
} satisfies Record<ComponentTypeName, z.ZodType<Record<string, unknown>>>;

const componentTypeUnion = componentTypes.map((type) => JSON.stringify(type)).join(" | ");

/**
 * Catalog-specific portion of the generative-UI prompt.
 *
 * This stays core-owned so the agent prompt and the UI contract share the same
 * component list and prop shapes.
 */
export const catalogPrompt = `JsonRenderSpec is:
{
  "root": "elementKey",
  "elements": {
    "elementKey": {
      "type": ${componentTypeUnion},
      "props": {},
      "children": ["childElementKey"]
    }
  }
}

Allowed component props:
- Button: {"label": string, "action"?: string}
- Card: {"title"?: string}
- ImagePlaceholder: {"alt"?: string, "prompt"?: string}
- ProductCard: {"title": string, "description": string, "imageAlt"?: string, "imagePrompt"?: string}
- ProductGrid: {"heading"?: string}
- Stack: {"direction"?: "row" | "column", "gap"?: "xs" | "sm" | "md" | "lg"}
- Text: {"text": string, "variant"?: "title" | "body" | "muted" | "caption"}
- TextInput: {"label": string, "name": string, "placeholder"?: string, "inputType"?: "text" | "email" | "password"}
- product-card: {"id": string, "title": string, "description": string, "imageUrl"?: string, "status"?: "streaming" | "complete"}

Rules:
- Use unique element keys.
- Every element must include props and children, even when empty.
- Every child key must exist in elements.
- Never use component types outside the allowed catalog.
- Qualification questions must be emitted as {"type":"question",...} updates, not as JsonRenderSpec UI.
- Product details belong in JsonRenderSpec UI updates. Use ProductGrid as the root when showing multiple products.
- A product card must include a clear title, description, and either imagePrompt or a child ImagePlaceholder.
- When streaming more than one product over time, emit a complete ProductGrid spec each time with the previous products preserved plus the new product.`;

const knownComponentTypes = new Set<string>(componentTypes);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeElement(value: unknown): UIElement | null {
  if (!isRecord(value)) {
    return null;
  }

  const type = value.type;
  if (typeof type !== "string" || !knownComponentTypes.has(type)) {
    return null;
  }

  if (!isRecord(value.props)) {
    return null;
  }

  const rawChildren = value.children ?? [];
  if (!Array.isArray(rawChildren) || rawChildren.some((child) => typeof child !== "string")) {
    return null;
  }

  const parsedProps = componentPropsSchemas[type as ComponentTypeName].safeParse(value.props);
  if (!parsedProps.success) {
    return null;
  }

  return {
    type,
    props: parsedProps.data,
    children: rawChildren,
    ...(value.visible !== undefined ? { visible: value.visible as UIElement["visible"] } : {}),
  };
}

export function normalizeStreamingSpec(value: unknown): Spec | null {
  if (!isRecord(value) || typeof value.root !== "string" || !isRecord(value.elements)) {
    return null;
  }

  if (!(value.root in value.elements)) {
    return null;
  }

  const elements: Spec["elements"] = {};

  for (const [key, elementValue] of Object.entries(value.elements)) {
    const element = normalizeElement(elementValue);
    if (!element) {
      return null;
    }
    elements[key] = element;
  }

  for (const [key, element] of Object.entries(elements)) {
    for (const child of element.children ?? []) {
      if (!(child in elements)) {
        return null;
      }
      if (child === key) {
        return null;
      }
    }
  }

  return {
    root: value.root,
    elements,
  };
}
