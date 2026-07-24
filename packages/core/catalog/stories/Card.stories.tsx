import type { Meta, StoryObj } from "@storybook/react";

import { CatalogSpecPreview, catalog, singleSpec, specFromInstances } from "./_helpers.tsx";

const meta = {
  title: "Core Catalog/Card",
  tags: ["autodocs", "a11y-ready"],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component: [
          "**Catalog identifier:** `Card`",
          "",
          "**Source file:** [`packages/core/catalog/catalog.json`](../../catalog.json) (schema) · rendered via [`packages/web-app/src/ui/catalog.tsx`](../../../web-app/src/ui/catalog.tsx).",
          "",
          "**Purpose:** A bordered content container. Optional `title` appears above children. Accepts child components via the standard `children: string[]` graph contract.",
          "",
          "### Catalog schema (authoritative)",
          "```json",
          JSON.stringify(catalog.components.Card, null, 2),
          "```",
          "",
          "### Production renderer",
          'Renders `<section class="jr-card">` with an optional `<h3>{title}</h3>` followed by rendered children. No title leaves only the children area.',
          "",
          "### Example usage from `packages/web-app`",
          "```tsx",
          "const spec = {",
          "  root: 'summary',",
          "  elements: {",
          "    summary: {",
          "      type: 'Card',",
          "      props: { title: 'Overview' },",
          "      children: ['intro'],",
          "    },",
          "    intro: { type: 'Text', props: { text: 'Hello', variant: 'body' } },",
          "  },",
          "};",
          "```",
        ].join("\n"),
      },
    },
  },
  argTypes: {
    title: {
      control: "text",
      description: "Optional heading rendered as an `<h3>`. Omit for a title-less card.",
      table: { type: { summary: "string" }, category: "Props" },
    },
  },
  args: { title: "Overview" },
  render: ({ title }) => (
    <CatalogSpecPreview
      spec={specFromInstances(
        [
          { id: "card", component: "Card", ...(title ? { title } : {}), children: ["intro"] },
          {
            id: "intro",
            component: "Text",
            text: "A bordered container for grouping related content.",
            variant: "body",
          },
        ],
        "card",
      )}
    />
  ),
} satisfies Meta<{ title?: string }>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { title: "Overview" },
};

export const WithoutTitle: Story = {
  args: { title: undefined },
  parameters: {
    docs: {
      description: {
        story:
          "Without `title`, no `<h3>` is emitted — the card shows only its children. Useful when the surrounding context already supplies a heading.",
      },
    },
  },
};

export const LongTitle: Story = {
  args: {
    title: "A lengthy, descriptive heading that exercises the renderer's overflow handling",
  },
  parameters: {
    docs: {
      description: {
        story: "Titles use `overflow-wrap: anywhere` so very long headings wrap inside the card.",
      },
    },
  },
};

export const WithMixedChildren: Story = {
  args: { title: "Launch readiness" },
  render: ({ title }) => (
    <CatalogSpecPreview
      spec={specFromInstances(
        [
          { id: "card", component: "Card", title, children: ["intro", "cta"] },
          {
            id: "intro",
            component: "Text",
            text: "Three sub-tasks remain before we can hand this off.",
            variant: "body",
          },
          { id: "cta", component: "Button", label: "View tasks", action: "demo_action" },
        ],
        "card",
      )}
    />
  ),
  parameters: {
    docs: {
      description: {
        story:
          "Card accepts any catalog component as a child. Here a `Text` body sits beside a `Button` call-to-action.",
      },
    },
  },
};

export const Empty: Story = {
  args: { title: undefined },
  render: ({ title }) => (
    <CatalogSpecPreview spec={singleSpec("Card", title ? { title } : {}, "card")} />
  ),
  parameters: {
    docs: {
      description: {
        story:
          "A card with no title and no children renders as an empty bordered box. Catalog allows it; designers usually want to guard against it upstream.",
      },
    },
  },
};
