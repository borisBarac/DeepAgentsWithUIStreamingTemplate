import type { Meta, StoryObj } from "@storybook/react";

import { CatalogSpecPreview, catalog, specFromInstances } from "./_helpers.tsx";

const sampleCards = [
  {
    id: "card-1",
    title: "Launch Map",
    description: "A planning workspace for design teams.",
    imagePrompt: "Kanban board with milestones",
  },
  {
    id: "card-2",
    title: "Brief Buddy",
    description: "Turn rough notes into structured creative briefs.",
    imagePrompt: "Notepad with sticky tabs",
  },
  {
    id: "card-3",
    title: "Research Concierge",
    description: "An AI assistant that drafts literature scans weekly.",
    imagePrompt: "Stacked research reports",
  },
] as const;

const meta = {
  title: "Core Catalog/ProductGrid",
  tags: ["autodocs", "a11y-ready"],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component: [
          "**Catalog identifier:** `ProductGrid`",
          "",
          "**Source file:** [`packages/core/catalog/catalog.json`](../../catalog.json) (schema) · rendered via [`packages/web-app/src/ui/catalog.tsx`](../../../web-app/src/ui/catalog.tsx).",
          "",
          "**Purpose:** A responsive container for one or more `ProductCard`s. Optional `heading` renders as an `<h2>`.",
          "",
          "### Catalog schema (authoritative)",
          "```json",
          JSON.stringify(catalog.components.ProductGrid, null, 2),
          "```",
          "",
          "### Production renderer",
          'Renders `<section class="product-grid-shell">` containing an optional `<h2>{heading}</h2>` and a `.product-grid` auto-fitting children into `minmax(220px, 1fr)` columns.',
          "",
          "### Responsive behavior",
          "- Desktop wide (≥1181px): the grid lays out as many columns as fit at `220px` min width.",
          "- Tablet/mobile: the web-app shell stacks panels; the grid itself remains responsive and collapses to a single column at small widths.",
          "",
          "### Example usage from `packages/web-app`",
          "```tsx",
          "const spec = componentInstancesToSpec([",
          "  { id: 'products', component: 'ProductGrid', heading: 'Concepts', children: ['card-1','card-2'] },",
          "  { id: 'card-1', component: 'ProductCard', title: 'Launch Map', description: '...', imagePrompt: '...' },",
          "  { id: 'card-2', component: 'ProductCard', title: 'Brief Buddy', description: '...', imagePrompt: '...' },",
          "]);",
          "```",
        ].join("\n"),
      },
    },
  },
  argTypes: {
    heading: {
      control: "text",
      description: "Optional `<h2>` heading rendered above the grid. Omit for a title-less grid.",
      table: { type: { summary: "string" }, category: "Props" },
    },
  },
  args: { heading: "Concepts" },
  render: ({ heading }) => (
    <CatalogSpecPreview
      spec={specFromInstances(
        [
          {
            id: "grid",
            component: "ProductGrid",
            ...(heading ? { heading } : {}),
            children: sampleCards.map((card) => card.id),
          },
          ...sampleCards.map((card) => ({
            id: card.id,
            component: "ProductCard" as const,
            title: card.title,
            description: card.description,
            imagePrompt: card.imagePrompt,
          })),
        ],
        "grid",
      )}
    />
  ),
} satisfies Meta<{ heading?: string }>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { heading: "Concepts" },
};

export const WithoutHeading: Story = {
  args: { heading: undefined },
  parameters: {
    docs: {
      description: {
        story: "Without `heading`, only the responsive grid is rendered.",
      },
    },
  },
};

export const SingleCard: Story = {
  args: { heading: "Featured product" },
  render: ({ heading }) => (
    <CatalogSpecPreview
      spec={specFromInstances(
        [
          {
            id: "grid",
            component: "ProductGrid",
            ...(heading ? { heading } : {}),
            children: ["card-1"],
          },
          {
            id: "card-1",
            component: "ProductCard",
            title: sampleCards[0]?.title ?? "",
            description: sampleCards[0]?.description ?? "",
            imagePrompt: sampleCards[0]?.imagePrompt,
          },
        ],
        "grid",
      )}
    />
  ),
  parameters: {
    docs: {
      description: {
        story:
          "A grid with one card is allowed by the catalog. The auto-fit column rule leaves the lone card filling the available width.",
      },
    },
  },
};

export const ManyCards: Story = {
  args: { heading: "Roadmap candidates" },
  render: ({ heading }) => {
    const cards = Array.from({ length: 6 }, (_, index) => ({
      id: `card-${index + 1}`,
      title: `Concept ${index + 1}`,
      description: `Description for the ${ordinal(index + 1)} concept card.`,
      imagePrompt: `Concept ${index + 1} mood board`,
    }));
    return (
      <CatalogSpecPreview
        spec={specFromInstances(
          [
            {
              id: "grid",
              component: "ProductGrid",
              ...(heading ? { heading } : {}),
              children: cards.map((card) => card.id),
            },
            ...cards.map((card) => ({
              ...card,
              component: "ProductCard" as const,
            })),
          ],
          "grid",
        )}
      />
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          "The catalog's `maxComponents` limit (100) bounds the worst case. The web-app additionally drops earlier `ProductGrid`/`ProductCard` specs whenever a new canonical grid arrives — see `appendUiSpec`.",
      },
    },
  },
};

export const Empty: Story = {
  args: { heading: undefined },
  render: ({ heading }) => (
    <CatalogSpecPreview
      spec={specFromInstances(
        [
          {
            id: "grid",
            component: "ProductGrid",
            ...(heading ? { heading } : {}),
            children: [],
          },
        ],
        "grid",
      )}
    />
  ),
  parameters: {
    docs: {
      description: {
        story:
          "A grid with no children renders an empty `.product-grid` shell. The catalog permits it; production agents always emit at least one card.",
      },
    },
  },
};

export const ResponsiveNarrow: Story = {
  args: { heading: "Concepts" },
  parameters: {
    viewport: { defaultViewport: "mobile1" },
    chromatic: { viewports: [320, 600] },
    docs: {
      description: {
        story:
          "Mobile viewport. The grid collapses to one column at narrow widths via `grid-template-columns: repeat(auto-fit, minmax(220px, 1fr))`.",
      },
    },
  },
};

function ordinal(value: number): string {
  const suffixes = ["th", "st", "nd", "rd"];
  const modulo = value % 100;
  return value + (suffixes[(modulo - 20) % 10] ?? suffixes[modulo] ?? suffixes[0]);
}
