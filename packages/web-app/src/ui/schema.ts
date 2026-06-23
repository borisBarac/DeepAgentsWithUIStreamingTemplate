import { z } from "zod";

export const componentTypes = ["Card", "Stack", "Text", "TextInput", "Button"] as const;
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

export const componentPropsSchemas = {
  Button: buttonPropsSchema,
  Card: cardPropsSchema,
  Stack: stackPropsSchema,
  Text: textPropsSchema,
  TextInput: textInputPropsSchema,
} satisfies Record<ComponentTypeName, z.ZodType<Record<string, unknown>>>;

export const catalogPrompt = `Return only JSON. The JSON must have this exact top-level shape:
{"updates":[...]}

Each update must be one of:
{"type":"message","text":"short assistant message"}
{"type":"ui","spec":<JsonRenderSpec>}
{"type":"error","message":"short error message"}

JsonRenderSpec is:
{
  "root": "elementKey",
  "elements": {
    "elementKey": {
      "type": "Card" | "Stack" | "Text" | "TextInput" | "Button",
      "props": {},
      "children": ["childElementKey"]
    }
  }
}

Allowed component props:
- Card: {"title"?: string}
- Stack: {"direction"?: "row" | "column", "gap"?: "xs" | "sm" | "md" | "lg"}
- Text: {"text": string, "variant"?: "title" | "body" | "muted" | "caption"}
- TextInput: {"label": string, "name": string, "placeholder"?: string, "inputType"?: "text" | "email" | "password"}
- Button: {"label": string, "action"?: string}

Rules:
- Use unique element keys.
- Every element must include props and children, even when empty.
- Every child key must exist in elements.
- Never use component types outside the allowed catalog.
- Prefer streaming several small updates: first a message, then one ui spec.
- Do not wrap the JSON in Markdown or prose.`;
