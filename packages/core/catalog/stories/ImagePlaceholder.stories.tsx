import type { Meta, StoryObj } from "@storybook/react";

import { CatalogSpecPreview, catalog, singleSpec } from "./_helpers.tsx";

const meta = {
  title: "Core Catalog/ImagePlaceholder",
  tags: ["autodocs", "a11y-ready"],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component: [
          "**Catalog identifier:** `ImagePlaceholder`",
          "",
          "**Source file:** [`packages/core/catalog/catalog.json`](../../catalog.json) (schema) · rendered via [`packages/web-app/src/ui/catalog.tsx`](../../../web-app/src/ui/catalog.tsx).",
          "",
          "**Purpose:** A visual placeholder for a product image that can later be rendered. The agent emits a `prompt` describing the intended image; the host swaps in a real asset when one is generated.",
          "",
          "### Catalog schema (authoritative)",
          "```json",
          JSON.stringify(catalog.components.ImagePlaceholder, null, 2),
          "```",
          "",
          "### Production renderer",
          'Renders `<div class="product-image" role="img" aria-label="…">`. The label falls back to `alt` → `"Product image placeholder"`. Inner text falls back to `prompt` → `alt` → `"Image concept"`.',
          "",
          "### Example usage from `packages/web-app`",
          "```tsx",
          "const spec = {",
          "  root: 'image',",
          "  elements: {",
          "    image: {",
          "      type: 'ImagePlaceholder',",
          "      props: {",
          "        alt: 'Workspace sketch',",
          "        prompt: 'A minimal desk with a lamp and notebook',",
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
    alt: {
      control: "text",
      description:
        'Accessible label for the placeholder. Falls back to `"Product image placeholder"` when omitted.',
      table: { type: { summary: "string" }, category: "Props" },
    },
    prompt: {
      control: "text",
      description:
        'Short description of the intended image. Displayed as the inner caption; falls back to `alt` then `"Image concept"`.',
      table: { type: { summary: "string" }, category: "Props" },
    },
  },
  args: {
    alt: "Product image placeholder",
    prompt: "Kanban board with milestones",
  },
  render: ({ alt, prompt }) => (
    <CatalogSpecPreview spec={singleSpec("ImagePlaceholder", { alt, prompt }, "image")} />
  ),
} satisfies Meta<{ alt?: string; prompt?: string }>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    alt: "Workspace sketch",
    prompt: "A minimal desk with a lamp and notebook",
  },
};

export const PromptOnly: Story = {
  args: { prompt: "A neutral textile swatch in soft daylight" },
  parameters: {
    docs: {
      description: {
        story:
          'When `alt` is missing the renderer uses the default label `"Product image placeholder"`. Useful when the agent only emits a `prompt`.',
      },
    },
  },
};

export const AltOnly: Story = {
  args: { alt: "Moodboard tile" },
  parameters: {
    docs: {
      description: {
        story:
          "When only `alt` is provided the inner caption reuses it — `alt` is the accessible label and the visible fallback text.",
      },
    },
  },
};

export const Empty: Story = {
  args: { alt: undefined, prompt: undefined },
  parameters: {
    docs: {
      description: {
        story:
          'A placeholder with no props renders the accessible label `"Product image placeholder"` and visible text `"Image concept"`.',
      },
    },
  },
};

export const LongPrompt: Story = {
  args: {
    alt: "Storyboard frame",
    prompt:
      "A wide-angle frame of a designer's desk with sketches pinned to the wall, soft window light from camera left, and a small ceramic cup of coffee steaming in the foreground",
  },
  parameters: {
    docs: {
      description: {
        story:
          "Long prompts wrap inside the caption (`.product-image span` uses `overflow-wrap: anywhere`).",
      },
    },
  },
};
