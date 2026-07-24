import type { Meta, StoryObj } from "@storybook/react";

import {
  CatalogSpecPreview,
  catalog,
  catalogComponentNames,
  catalogVersion,
  specFromInstances,
  uiSpecUpdate,
} from "./_helpers.tsx";

const overviewSpec = specFromInstances(
  [
    {
      id: "shell",
      component: "Stack",
      direction: "column",
      gap: "lg",
      children: ["headline", "grid", "actions", "form-card"],
    },
    {
      id: "headline",
      component: "Text",
      text: "Catalog overview",
      variant: "title",
    },
    {
      id: "grid",
      component: "ProductGrid",
      heading: "Sample concepts",
      children: ["card-1", "card-2"],
    },
    {
      id: "card-1",
      component: "ProductCard",
      title: "Launch Map",
      description: "A planning workspace for design teams.",
      imagePrompt: "Kanban board with milestones",
      children: ["status"],
    },
    {
      id: "status",
      component: "Text",
      text: "Early concept",
      variant: "muted",
    },
    {
      id: "card-2",
      component: "ProductCard",
      title: "Brief Buddy",
      description: "Turn rough notes into structured creative briefs.",
      imagePrompt: "Notepad with sticky tabs",
    },
    {
      id: "actions",
      component: "Stack",
      direction: "row",
      gap: "sm",
      children: ["primary", "secondary", "placeholder"],
    },
    {
      id: "primary",
      component: "Button",
      label: "Open Launch Map",
      action: "demo_action",
    },
    {
      id: "secondary",
      component: "Button",
      label: "Cancel",
    },
    {
      id: "placeholder",
      component: "ImagePlaceholder",
      alt: "Brand tile",
      prompt: "Soft daylight over a tidy desk",
    },
    {
      id: "form-card",
      component: "Card",
      title: "Stay in the loop",
      children: ["form-stack"],
    },
    {
      id: "form-stack",
      component: "Stack",
      direction: "column",
      gap: "md",
      children: ["email", "caption", "subscribe"],
    },
    {
      id: "email",
      component: "TextInput",
      label: "Email",
      name: "email",
      inputType: "email",
      placeholder: "you@team.com",
    },
    {
      id: "caption",
      component: "Text",
      text: "Weekly digest, no spam.",
      variant: "caption",
    },
    {
      id: "subscribe",
      component: "Button",
      label: "Subscribe",
      action: "submit_demo",
    },
  ],
  "shell",
);

const meta = {
  title: "Core Catalog/Overview",
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component: [
          "**Catalog:** `packages/core/catalog/catalog.json`",
          `**Version:** \`${catalogVersion}\``,
          "",
          `**Components in this catalog (\`${catalogComponentNames.length}\` total):**`,
          ...catalogComponentNames.map((name) => `- \`${name}\``),
          "",
          "### Limits (shared by the validator and the client mini-validator)",
          "```json",
          JSON.stringify({ version: catalogVersion, limits: catalog.limits }, null, 2),
          "```",
          "",
          "### Validation rules enforced at runtime",
          "- Every component must have a unique `id` and an allowed `component` name.",
          "- `rootId`, when present, must exist in `components`.",
          "- `children` must contain only existing component IDs and never the component's own ID.",
          "- No cycles, no unreachable elements, no duplicate IDs.",
          "- `components.length` ≤ `limits.maxComponents` (100).",
          "- Strings ≤ `limits.maxStringLength` (4096).",
          "- Serialized payload ≤ `limits.maxJsonBytes` (128 KiB).",
          "",
          "Source: [`packages/core/src/generative-ui/validator.ts`](../../src/generative-ui/validator.ts) and the browser-side [`validate-spec.ts`](../../../web-app/src/ui/validate-spec.ts).",
        ].join("\n"),
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllComponentsTogether: Story = {
  render: () => <CatalogSpecPreview spec={overviewSpec} />,
  parameters: {
    docs: {
      description: {
        story:
          "A single spec that exercises every catalog component in one render tree. Useful as a smoke test that all renderers cooperate.",
      },
    },
  },
};

export const OnTheWireOverview: Story = {
  render: () => (
    <pre
      style={{
        background: "#0b484a",
        borderRadius: 8,
        color: "#dff0ea",
        fontSize: 12,
        margin: 0,
        overflow: "auto",
        padding: 16,
      }}
    >
      {[
        "// The agent emits a single NDJSON line per UiUpdate.",
        "// This is the exact payload that produced the AllComponentsTogether story:",
        "",
        JSON.stringify(
          uiSpecUpdate(
            Object.entries(overviewSpec.elements).map(([id, entry]) => stripType(entry, id)),
            "shell",
          ),
          null,
          2,
        ),
      ].join("\n")}
    </pre>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'The on-the-wire shape: a single `UiSpecUpdate` with `rootId: "shell"` and one entry per catalog component.',
      },
    },
  },
};

type ElementLike = {
  type: string;
  props: Record<string, unknown>;
  children?: string[];
};

type InstanceLike = {
  id: string;
  component: string;
  children?: string[];
  [key: string]: unknown;
};

function stripType(entry: ElementLike, id: string): InstanceLike {
  const { type, props, children } = entry;
  return {
    id,
    component: type,
    ...props,
    ...(children ? { children } : {}),
  };
}
