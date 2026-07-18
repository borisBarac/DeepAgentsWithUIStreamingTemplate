import type { A2UIValidationErrorCode } from "./errors.ts";

export type AcceptedUiUpdateFixture = {
  name: string;
  value: unknown;
};

export type RejectedUiUpdateFixture = AcceptedUiUpdateFixture & {
  errorCode: A2UIValidationErrorCode;
};

export const acceptedUiUpdateFixtures: readonly AcceptedUiUpdateFixture[] = [
  {
    name: "valid nested UI",
    value: {
      type: "ui",
      rootId: "layout",
      components: [
        { id: "layout", component: "Stack", direction: "column", gap: "md", children: ["card"] },
        { id: "card", component: "Card", title: "Summary", children: ["body", "action"] },
        { id: "body", component: "Text", text: "Ready", variant: "body" },
        { id: "action", component: "Button", label: "Continue", action: "continue" },
      ],
    },
  },
  {
    name: "valid non-UI update",
    value: { type: "message", text: "Hello" },
  },
  {
    name: "valid product image URI",
    value: {
      type: "ui",
      components: [
        {
          id: "product",
          component: "product-card",
          title: "Lamp",
          description: "Adjustable desk lamp",
          imageUrl: "https://example.com/lamp.png",
        },
      ],
    },
  },
];

export const rejectedUiUpdateFixtures: readonly RejectedUiUpdateFixture[] = [
  {
    name: "malformed envelope",
    value: { type: "ui", components: "not-an-array" },
    errorCode: "invalid_envelope",
  },
  {
    name: "unknown component",
    value: { type: "ui", components: [{ id: "x", component: "Mystery" }] },
    errorCode: "unknown_component",
  },
  {
    name: "missing required prop",
    value: { type: "ui", components: [{ id: "x", component: "Button" }] },
    errorCode: "invalid_envelope",
  },
  {
    name: "extra prop",
    value: {
      type: "ui",
      components: [{ id: "x", component: "Text", text: "Hello", unexpected: true }],
    },
    errorCode: "invalid_envelope",
  },
  {
    name: "duplicate id",
    value: {
      type: "ui",
      components: [
        { id: "same", component: "Text", text: "First" },
        { id: "same", component: "Text", text: "Second" },
      ],
    },
    errorCode: "duplicate_id",
  },
  {
    name: "missing child",
    value: {
      type: "ui",
      components: [{ id: "root", component: "Stack", children: ["missing"] }],
    },
    errorCode: "missing_child",
  },
  {
    name: "cycle",
    value: {
      type: "ui",
      rootId: "a",
      components: [
        { id: "a", component: "Stack", children: ["b"] },
        { id: "b", component: "Card", children: ["a"] },
      ],
    },
    errorCode: "cyclic_reference",
  },
  {
    name: "unreachable node",
    value: {
      type: "ui",
      rootId: "root",
      components: [
        { id: "root", component: "Text", text: "Visible" },
        { id: "orphan", component: "Text", text: "Hidden" },
      ],
    },
    errorCode: "unreachable_element",
  },
  {
    name: "missing root",
    value: {
      type: "ui",
      rootId: "missing",
      components: [{ id: "root", component: "Text", text: "Hello" }],
    },
    errorCode: "missing_root_element",
  },
  {
    name: "empty components",
    value: { type: "ui", components: [] },
    errorCode: "empty_components",
  },
  {
    name: "URI without content",
    value: {
      type: "ui",
      components: [
        {
          id: "product",
          component: "product-card",
          title: "Lamp",
          description: "Adjustable desk lamp",
          imageUrl: "foo:",
        },
      ],
    },
    errorCode: "invalid_envelope",
  },
  {
    name: "URI with malformed percent escape",
    value: {
      type: "ui",
      components: [
        {
          id: "product",
          component: "product-card",
          title: "Lamp",
          description: "Adjustable desk lamp",
          imageUrl: "https://example.com/%zz",
        },
      ],
    },
    errorCode: "invalid_envelope",
  },
];
