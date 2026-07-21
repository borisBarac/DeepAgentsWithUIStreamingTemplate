import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "storybook/test";

import { CatalogSpecPreview, catalog, singleSpec } from "./_helpers.tsx";

const meta = {
  title: "Core Catalog/Button",
  tags: ["autodocs", "a11y-ready"],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component: [
          "**Catalog identifier:** `Button`",
          "",
          "**Source file:** [`packages/core/catalog/catalog.json`](../../catalog.json) (schema) · rendered via [`packages/web-app/src/ui/catalog.tsx`](../../../web-app/src/ui/catalog.tsx).",
          "",
          "**Purpose:** A button for local UI actions. The agent pairs the button with a concise `label` and (optionally) an `action` identifier the host application wires up.",
          "",
          "### Catalog schema (authoritative)",
          "```json",
          JSON.stringify(catalog.components.Button, null, 2),
          "```",
          "",
          "### Production renderer",
          'Renders a native `<button class="jr-button">` with `type="button"`. The optional `action` string is forwarded to the host action handler (`demo_action` and `submit_demo` are pre-wired in the web-app preview).',
          "",
          "### Example usage from `packages/web-app`",
          "```tsx",
          "// JsonRenderPreview builds the spec from the agent stream:",
          "const spec = {",
          "  root: 'cta',",
          "  elements: {",
          "    cta: { type: 'Button', props: { label: 'Open details', action: 'demo_action' } },",
          "  },",
          "};",
          "<Renderer loading={false} registry={registry} spec={spec} />",
          "```",
        ].join("\n"),
      },
    },
  },
  argTypes: {
    label: {
      control: "text",
      description: "Visible button label. Required. Catalog enforces `maxLength: 4096`.",
      table: { type: { summary: "string" }, category: "Props" },
    },
    action: {
      control: "text",
      description:
        "Optional action identifier dispatched to the host. `demo_action` and `submit_demo` are pre-wired in the web-app preview; other values surface a not-wired message.",
      table: { type: { summary: "string" }, category: "Props" },
    },
  },
  args: { label: "Send", action: "demo_action" },
  render: ({ label, action }) => (
    <CatalogSpecPreview spec={singleSpec("Button", { label, action }, "button")} />
  ),
} satisfies Meta<{ label: string; action?: string }>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { label: "Continue", action: "demo_action" },
};

export const WithoutAction: Story = {
  args: { label: "Details" },
  parameters: {
    docs: {
      description: {
        story:
          "When `action` is omitted the button still renders and is clickable, but no host action fires — useful for buttons that only have meaning when paired with a form submission.",
      },
    },
  },
};

export const SubmitDemo: Story = {
  args: { label: "Submit", action: "submit_demo" },
  parameters: {
    docs: {
      description: {
        story:
          "`submit_demo` is wired by `JsonRenderPreview` and is also triggered when the surrounding `<form>` is submitted. Clicking this button surfaces the feedback message below the rendered spec.",
      },
    },
  },
};

export const UnknownAction: Story = {
  args: { label: "Run workflow", action: "nonexistent_action" },
  parameters: {
    docs: {
      description: {
        story:
          'Actions the host has not wired up surface the message `Action "<name>" is not wired yet.` instead of throwing — see `getActionFeedbackMessage`.',
      },
    },
  },
};

export const LongLabel: Story = {
  args: {
    label:
      "Generate a fully costed launch plan with timeline, risks, and recommended owner per workstream",
    action: "demo_action",
  },
  parameters: {
    docs: {
      description: {
        story:
          "Long labels wrap because `.jr-button` does not truncate. The catalog cap is 4096 characters; product copy stays well under it.",
      },
    },
  },
};

export const Empty: Story = {
  args: { label: "" },
  parameters: {
    docs: {
      description: {
        story:
          "Empty-label buttons are technically valid against the catalog schema (only `maxLength` is enforced) but render as a collapsed element. Designers should add a guardrail upstream.",
      },
    },
  },
};

export const ClickInteraction: Story = {
  args: { label: "Click me", action: "demo_action" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole("button", { name: "Click me" });
    await userEvent.click(button);
    const feedback = await canvas.findByText("Demo action ran.");
    await expect(feedback).toBeVisible();
  },
  parameters: {
    docs: {
      description: {
        story:
          'Interactive story. Click the button (or let the `play` function do it) — the action handler in `JsonRenderPreview` surfaces feedback text via an `aria-live="polite"` region.',
      },
    },
  },
};
