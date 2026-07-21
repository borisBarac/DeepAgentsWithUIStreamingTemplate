import type { Meta, StoryObj } from "@storybook/react";

import { CatalogSpecPreview, catalog, specFromInstances } from "./_helpers.tsx";

const meta = {
  title: "Core Catalog/Stack",
  tags: ["autodocs", "a11y-ready"],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component: [
          "**Catalog identifier:** `Stack`",
          "",
          "**Source file:** [`packages/core/catalog/catalog.json`](../../catalog.json) (schema) · rendered via [`packages/web-app/src/ui/catalog.tsx`](../../../web-app/src/ui/catalog.tsx).",
          "",
          '**Purpose:** A layout container. Use `direction: "column"` for forms and `direction: "row"` for compact action groups.',
          "",
          "### Catalog schema (authoritative)",
          "```json",
          JSON.stringify(catalog.components.Stack, null, 2),
          "```",
          "",
          "### Production renderer",
          'Renders `<div class="jr-stack jr-stack-{direction} jr-gap-{gap}">` where direction defaults to `column` and gap defaults to `md`.',
          "",
          "### Example usage from `packages/web-app`",
          "```tsx",
          "const spec = componentInstancesToSpec([",
          "  {",
          "    id: 'stack',",
          "    component: 'Stack',",
          "    direction: 'row',",
          "    gap: 'sm',",
          "    children: ['primary', 'secondary',",
          "  ]},",
          "  { id: 'primary', component: 'Button', label: 'Save', action: 'submit_demo' },",
          "  { id: 'secondary', component: 'Button', label: 'Cancel' },",
          "]);",
          "```",
        ].join("\n"),
      },
    },
  },
  argTypes: {
    direction: {
      control: "inline-radio",
      options: ["row", "column"],
      description: "Layout direction. Defaults to `column` when omitted.",
      table: {
        type: { summary: '"row" | "column"' },
        defaultValue: { summary: "column" },
        category: "Props",
      },
    },
    gap: {
      control: "inline-radio",
      options: ["xs", "sm", "md", "lg"],
      description: "Spacing between children. Defaults to `md` when omitted.",
      table: {
        type: { summary: '"xs" | "sm" | "md" | "lg"' },
        defaultValue: { summary: "md" },
        category: "Props",
      },
    },
  },
  args: { direction: "row", gap: "md" },
  render: ({ direction, gap }) => (
    <CatalogSpecPreview
      spec={specFromInstances(
        [
          {
            id: "stack",
            component: "Stack",
            ...(direction ? { direction } : {}),
            ...(gap ? { gap } : {}),
            children: ["primary", "secondary"],
          },
          { id: "primary", component: "Button", label: "Save", action: "submit_demo" },
          { id: "secondary", component: "Button", label: "Cancel" },
        ],
        "stack",
      )}
    />
  ),
} satisfies Meta<{ direction?: "row" | "column"; gap?: "xs" | "sm" | "md" | "lg" }>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { direction: "row", gap: "md" },
};

export const Column: Story = {
  args: { direction: "column", gap: "md" },
  render: ({ direction, gap }) => (
    <CatalogSpecPreview
      spec={specFromInstances(
        [
          {
            id: "stack",
            component: "Stack",
            ...(direction ? { direction } : {}),
            ...(gap ? { gap } : {}),
            children: ["primary", "secondary", "tertiary"],
          },
          {
            id: "primary",
            component: "TextInput",
            label: "Email",
            name: "email",
            inputType: "email",
          },
          {
            id: "secondary",
            component: "TextInput",
            label: "Password",
            name: "password",
            inputType: "password",
          },
          { id: "tertiary", component: "Button", label: "Sign in", action: "submit_demo" },
        ],
        "stack",
      )}
    />
  ),
  parameters: {
    docs: {
      description: {
        story:
          '`direction: "column"` is the default and is the recommended layout for form fields and vertically stacked content.',
      },
    },
  },
};

export const GapVariants: Story = {
  render: () => (
    <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(2, 1fr)" }}>
      {(["xs", "sm", "md", "lg"] as const).map((gap) => (
        <div key={gap}>
          <p style={{ color: "#4f5f6c", fontSize: 12, fontWeight: 700, margin: "0 0 8px" }}>
            gap = {gap}
          </p>
          <CatalogSpecPreview
            spec={specFromInstances(
              [
                {
                  id: `stack-${gap}`,
                  component: "Stack",
                  direction: "row",
                  gap,
                  children: [`a-${gap}`, `b-${gap}`],
                },
                { id: `a-${gap}`, component: "Button", label: "A", action: "demo_action" },
                { id: `b-${gap}`, component: "Button", label: "B", action: "demo_action" },
              ],
              `stack-${gap}`,
            )}
          />
        </div>
      ))}
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          "Gap maps to CSS classes: `xs=6px`, `sm=10px`, `md=14px`, `lg=20px`. The agent can request any of these directly.",
      },
    },
  },
};

export const DefaultsOmitted: Story = {
  render: () => (
    <CatalogSpecPreview
      spec={specFromInstances(
        [
          { id: "stack", component: "Stack", children: ["a", "b"] },
          { id: "a", component: "Button", label: "Default direction", action: "demo_action" },
          { id: "b", component: "Button", label: "Default gap", action: "demo_action" },
        ],
        "stack",
      )}
    />
  ),
  parameters: {
    docs: {
      description: {
        story:
          "Omitting both `direction` and `gap` falls back to `column` + `md` — the safe default for any stack.",
      },
    },
  },
};

export const Empty: Story = {
  render: () => (
    <CatalogSpecPreview spec={specFromInstances([{ id: "stack", component: "Stack" }], "stack")} />
  ),
  parameters: {
    docs: {
      description: {
        story: "A `Stack` with no children renders an empty flex container.",
      },
    },
  },
};
