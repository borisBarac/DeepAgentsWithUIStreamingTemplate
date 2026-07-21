import type { Meta, StoryObj } from "@storybook/react";

import { CatalogSpecPreview, catalog, singleSpec } from "./_helpers.tsx";

const meta = {
  title: "Core Catalog/ProductCard",
  tags: ["autodocs", "a11y-ready"],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component: [
          "**Catalog identifier:** `ProductCard`",
          "",
          "**Source file:** [`packages/core/catalog/catalog.json`](../../catalog.json) (schema) · rendered via [`packages/web-app/src/ui/catalog.tsx`](../../../web-app/src/ui/catalog.tsx).",
          "",
          "**Purpose:** A product concept card. Pair with `ProductGrid` for the canonical agent-emitted product layout. `title` and `description` are required; `imagePrompt` is optional and doubles as the placeholder caption.",
          "",
          "### Catalog schema (authoritative)",
          "```json",
          JSON.stringify(catalog.components.ProductCard, null, 2),
          "```",
          "",
          "### Production renderer",
          'Renders `<article class="product-card">` containing a `.product-image` (role="img") and a `.product-card-body` with `<h3>{title}</h3>` and `<p>{description}</p>`. Optional children are appended after the description.',
          "",
          "### Example usage from `packages/web-app`",
          "```tsx",
          "const spec = {",
          "  root: 'card',",
          "  elements: {",
          "    card: {",
          "      type: 'ProductCard',",
          "      props: {",
          "        title: 'Launch Map',",
          "        description: 'A planning workspace for design teams.',",
          "        imagePrompt: 'Kanban board with milestones',",
          "      },",
          "    },",
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
      description: "Required card heading rendered as `<h3>`.",
      table: { type: { summary: "string" }, category: "Props" },
    },
    description: {
      control: "text",
      description: "Required body copy rendered as `<p>`.",
      table: { type: { summary: "string" }, category: "Props" },
    },
    imagePrompt: {
      control: "text",
      description:
        "Optional caption for the image placeholder. Falls back to the `aria-label` (which itself falls back to `title`).",
      table: { type: { summary: "string" }, category: "Props" },
    },
  },
  args: {
    title: "Launch Map",
    description: "A planning workspace for design teams.",
    imagePrompt: "Kanban board with milestones",
  },
  render: ({ title, description, imagePrompt }) => (
    <div style={{ maxWidth: 320 }}>
      <CatalogSpecPreview
        spec={singleSpec(
          "ProductCard",
          {
            title,
            description,
            ...(imagePrompt ? { imagePrompt } : {}),
          },
          "card",
        )}
      />
    </div>
  ),
} satisfies Meta<{
  title: string;
  description: string;
  imagePrompt?: string;
}>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: "Launch Map",
    description: "A planning workspace for design teams.",
    imagePrompt: "Kanban board with milestones",
  },
};

export const WithoutImagePrompt: Story = {
  args: {
    title: "Brief Buddy",
    description: "Turn rough notes into structured creative briefs.",
  },
  parameters: {
    docs: {
      description: {
        story:
          "Without `imagePrompt`, the placeholder caption falls back to the card's accessible label, which itself falls back to `title`.",
      },
    },
  },
};

export const LongDescription: Story = {
  args: {
    title: "Research concierge",
    description:
      "An AI research concierge that drafts literature scans, ranks sources, and ships a weekly digest to your inbox. Designed for product teams who need signal, not noise.",
    imagePrompt: "Concierge desk with neatly stacked reports",
  },
  parameters: {
    docs: {
      description: {
        story:
          "Description text wraps with `overflow-wrap: anywhere`; long copy degrades gracefully.",
      },
    },
  },
};

export const LongTitle: Story = {
  args: {
    title: "Customer Onboarding Assistant for B2B SaaS Teams Who Hate Spreadsheets",
    description: "A guided onboarding flow that replaces spreadsheets and sticky notes.",
    imagePrompt: "Onboarding checklist with checkmarks",
  },
};

export const Empty: Story = {
  args: { title: "", description: "" },
  parameters: {
    docs: {
      description: {
        story:
          "Catalog only enforces presence of `title` and `description` — empty strings technically pass. Designers should add a guardrail in the producing agent.",
      },
    },
  },
};

export const WithChildren: Story = {
  args: {
    title: "Launch Map",
    description: "A planning workspace for design teams.",
    imagePrompt: "Kanban board with milestones",
  },
  render: ({ title, description, imagePrompt }) => (
    <div style={{ maxWidth: 320 }}>
      <CatalogSpecPreview
        spec={{
          root: "card",
          elements: {
            card: {
              type: "ProductCard",
              props: {
                title,
                description,
                ...(imagePrompt ? { imagePrompt } : {}),
              },
              children: ["status"],
            },
            status: { type: "Text", props: { text: "Early concept", variant: "muted" } },
          },
        }}
      />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          "Optional children render after the description. Here a `Text` badge flags the card as an early concept.",
      },
    },
  },
};
