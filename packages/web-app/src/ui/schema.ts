import { z } from "zod";

export const componentTypes = [
  "Button",
  "Card",
  "ImagePlaceholder",
  "ProductCard",
  "ProductGrid",
  "Stack",
  "Text",
  "TextInput",
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
} satisfies Record<ComponentTypeName, z.ZodType<Record<string, unknown>>>;

/**
 * Catalog-specific portion of the generative-UI prompt.
 *
 * The NDJSON framing (`<JsonRenderSpec>` update kinds, one object per line) is
 * owned by core (`GENERATIVE_UI_NDJSON_PROMPT`) and prepended automatically when
 * passed to `createBaselineAgent({ generativeUi: { catalogPrompt } })`. This
 * constant only describes the `<JsonRenderSpec>` shape and the allowed
 * components, so it stays paired with the catalog schemas above.
 */
export const catalogPrompt = `JsonRenderSpec is:
{
  "root": "elementKey",
  "elements": {
    "elementKey": {
      "type": "Button" | "Card" | "ImagePlaceholder" | "ProductCard" | "ProductGrid" | "Stack" | "Text" | "TextInput",
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

Rules:
- Use unique element keys.
- Every element must include props and children, even when empty.
- Every child key must exist in elements.
- Never use component types outside the allowed catalog.
- Qualification questions must be emitted as {"type":"question",...} updates, not as JsonRenderSpec UI.
- Product details belong in JsonRenderSpec UI updates. Use ProductGrid as the root when showing multiple products.
- A product card must include a clear title, description, and either imagePrompt or a child ImagePlaceholder.
- When streaming more than one product over time, emit a complete ProductGrid spec each time with the previous products preserved plus the new product.`;
