import type { Meta, StoryObj } from "@storybook/react";

import { CatalogSpecPreview, catalog, singleSpec } from "./_helpers.tsx";

const meta = {
  title: "Core Catalog/Text",
  tags: ["autodocs", "a11y-ready"],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component: [
          "**Catalog identifier:** `Text`",
          "",
          "**Source file:** [`packages/core/catalog/catalog.json`](../../catalog.json) (schema) · rendered via [`packages/web-app/src/ui/catalog.tsx`](../../../web-app/src/ui/catalog.tsx).",
          "",
          '**Purpose:** Inline text content. Use `variant: "title"` for headings, `variant: "body"` (default) for prose, `variant: "muted"` for secondary text, and `variant: "caption"` for small labels.',
          "",
          "### Catalog schema (authoritative)",
          "```json",
          JSON.stringify(catalog.components.Text, null, 2),
          "```",
          "",
          "### Production renderer",
          '`title` renders as `<h2 class="jr-text jr-text-title">`; every other variant renders as `<p class="jr-text jr-text-{variant}">`.',
          "",
          "### Example usage from `packages/web-app`",
          "```tsx",
          "const spec = {",
          "  root: 'headline',",
          "  elements: {",
          "    headline: {",
          "      type: 'Text',",
          "      props: { text: 'Design with the agent', variant: 'title' },",
          "    },",
          "  },",
          "};",
          "```",
        ].join("\n"),
      },
    },
  },
  argTypes: {
    text: {
      control: "text",
      description: "Required text content.",
      table: { type: { summary: "string" }, category: "Props" },
    },
    variant: {
      control: "inline-radio",
      options: ["title", "body", "muted", "caption"],
      description: "Visual treatment. Defaults to `body` when omitted.",
      table: {
        type: { summary: '"title" | "body" | "muted" | "caption"' },
        defaultValue: { summary: "body" },
        category: "Props",
      },
    },
  },
  args: { text: "Design with the agent.", variant: "body" },
  render: ({ text, variant }) => (
    <CatalogSpecPreview
      spec={singleSpec("Text", { text, ...(variant ? { variant } : {}) }, "text")}
    />
  ),
} satisfies Meta<{ text: string; variant?: "title" | "body" | "muted" | "caption" }>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { text: "Design with the agent.", variant: "body" },
};

export const Title: Story = {
  args: { text: "Agent interaction workspace", variant: "title" },
  parameters: {
    docs: {
      description: {
        story:
          '`variant: "title"` is the only variant rendered as a heading element (`<h2>`). Use sparingly — page layout typically already owns one `<h1>`.',
      },
    },
  },
};

export const Muted: Story = {
  args: { text: "Secondary details appear here.", variant: "muted" },
};

export const Caption: Story = {
  args: { text: "Early concept", variant: "caption" },
};

export const LongText: Story = {
  args: {
    text: "A long-form product description that exercises the renderer's overflow handling. The catalog caps strings at 4096 characters; product copy should be considerably shorter than that to keep layouts readable.",
    variant: "body",
  },
  parameters: {
    docs: {
      description: {
        story: "Text uses `overflow-wrap: anywhere` so very long URLs or unbroken strings wrap.",
      },
    },
  },
};

export const Empty: Story = {
  args: { text: "" },
  parameters: {
    docs: {
      description: {
        story:
          "Empty strings technically pass the catalog (only presence of `text` is required). Renderers emit an empty element; designers should guard upstream.",
      },
    },
  },
};
