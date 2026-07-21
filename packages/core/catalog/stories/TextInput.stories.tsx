import type { Meta, StoryObj } from "@storybook/react";

import { CatalogSpecPreview, catalog, singleSpec } from "./_helpers.tsx";

const meta = {
  title: "Core Catalog/TextInput",
  tags: ["autodocs", "a11y-ready"],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component: [
          "**Catalog identifier:** `TextInput`",
          "",
          "**Source file:** [`packages/core/catalog/catalog.json`](../../catalog.json) (schema) · rendered via [`packages/web-app/src/ui/catalog.tsx`](../../../web-app/src/ui/catalog.tsx).",
          "",
          "**Purpose:** A controlled text field. `label` and `name` are required. `inputType` selects between `text`/`email`/`password` and informs the auto-filled `autocomplete` value.",
          "",
          "### Catalog schema (authoritative)",
          "```json",
          JSON.stringify(catalog.components.TextInput, null, 2),
          "```",
          "",
          "### Production renderer",
          'Renders `<label class="jr-field"><span>{label}</span><input …/></label>`. The input\'s value is bound to `/form/{name}` via `useDataBinding`, so multiple inputs share the JSON-UI form state.',
          "",
          "### Auto-fill heuristics (see `getTextInputAutoComplete`)",
          '- `inputType: "password"` + name contains `"new"` → `autocomplete="new-password"`',
          '- `inputType: "password"` otherwise → `autocomplete="current-password"`',
          '- `inputType: "email"` (or name contains `"email"`) → `autocomplete="email"`',
          "- Otherwise → no `autocomplete` attribute",
          "",
          "### Example usage from `packages/web-app`",
          "```tsx",
          "const spec = {",
          "  root: 'email',",
          "  elements: {",
          "    email: {",
          "      type: 'TextInput',",
          "      props: { label: 'Email', name: 'email', inputType: 'email', placeholder: 'you@team.com' },",
          "    },",
          "  },",
          "};",
          "```",
        ].join("\n"),
      },
    },
  },
  argTypes: {
    label: {
      control: "text",
      description: "Required visible label rendered inside the wrapping `<label>`.",
      table: { type: { summary: "string" }, category: "Props" },
    },
    name: {
      control: "text",
      description:
        "Required form field identifier. The renderer binds the value to `/form/{name}` via `useDataBinding`.",
      table: { type: { summary: "string" }, category: "Props" },
    },
    placeholder: {
      control: "text",
      description: "Optional placeholder text. Defaults to empty string.",
      table: { type: { summary: "string" }, category: "Props" },
    },
    inputType: {
      control: "inline-radio",
      options: ["text", "email", "password"],
      description:
        "Optional `<input type>` value. Drives the auto-filled `autocomplete` attribute via `getTextInputAutoComplete`.",
      table: {
        type: { summary: '"text" | "email" | "password"' },
        defaultValue: { summary: "text" },
        category: "Props",
      },
    },
  },
  args: {
    label: "Email",
    name: "email",
    placeholder: "you@team.com",
    inputType: "email",
  },
  render: ({ label, name, placeholder, inputType }) => (
    <div style={{ maxWidth: 360 }}>
      <CatalogSpecPreview
        spec={singleSpec(
          "TextInput",
          {
            label,
            name,
            ...(placeholder ? { placeholder } : {}),
            ...(inputType ? { inputType } : {}),
          },
          name,
        )}
      />
    </div>
  ),
} satisfies Meta<{
  label: string;
  name: string;
  placeholder?: string;
  inputType?: "text" | "email" | "password";
}>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    label: "Email",
    name: "email",
    placeholder: "you@team.com",
    inputType: "email",
  },
};

export const PlainText: Story = {
  args: { label: "Project name", name: "projectName", placeholder: "Launch map" },
  parameters: {
    docs: {
      description: {
        story:
          'Without `inputType`, the input renders as `type="text"` and no `autocomplete` attribute is emitted.',
      },
    },
  },
};

export const PasswordCurrent: Story = {
  args: {
    label: "Password",
    name: "password",
    placeholder: "••••••••",
    inputType: "password",
  },
  parameters: {
    docs: {
      description: {
        story:
          '`inputType: "password"` + a name without `"new"` → `autocomplete="current-password"`. Best for sign-in forms.',
      },
    },
  },
};

export const PasswordNew: Story = {
  args: {
    label: "New password",
    name: "newPassword",
    placeholder: "Pick a strong passphrase",
    inputType: "password",
  },
  parameters: {
    docs: {
      description: {
        story:
          'Names containing `"new"` switch the `autocomplete` hint to `new-password` so password managers offer to generate one.',
      },
    },
  },
};

export const WithoutPlaceholder: Story = {
  args: { label: "Workspace title", name: "title" },
  parameters: {
    docs: {
      description: {
        story: "When `placeholder` is omitted the input shows the browser's empty state.",
      },
    },
  },
};

export const EmptyLabels: Story = {
  args: { label: "", name: "anonymous", placeholder: "Catalog permits empty label" },
  parameters: {
    docs: {
      description: {
        story:
          "Catalog only checks that `label` and `name` are present strings; empty values are technically valid. Designers should add a guardrail upstream.",
      },
    },
  },
};

export const FormContext: Story = {
  render: () => (
    <div style={{ display: "grid", gap: 12, maxWidth: 360 }}>
      <CatalogSpecPreview
        spec={{
          root: "form",
          elements: {
            form: {
              type: "Stack",
              props: { direction: "column", gap: "md" },
              children: ["title", "email", "password", "submit"],
            },
            title: { type: "Text", props: { text: "Sign in", variant: "title" } },
            email: {
              type: "TextInput",
              props: {
                label: "Email",
                name: "email",
                inputType: "email",
                placeholder: "you@team.com",
              },
            },
            password: {
              type: "TextInput",
              props: { label: "Password", name: "password", inputType: "password" },
            },
            submit: { type: "Button", props: { label: "Sign in", action: "submit_demo" } },
          },
        }}
      />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          "Two TextInputs sharing a single Stack form context. Because each input binds to `/form/{name}`, a single `submit_demo` action can read the whole form from JSON-UI's data context.",
      },
    },
  },
};
