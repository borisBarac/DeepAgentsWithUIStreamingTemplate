import { describe, expect, it } from "bun:test";

import { componentInstancesToSpec } from "./spec-adapter.ts";

describe("componentInstancesToSpec", () => {
  const components = [
    {
      id: "layout",
      component: "Stack",
      children: ["title", "action"],
      direction: "vertical",
      gap: "md",
    },
    {
      id: "title",
      component: "Text",
      text: "Welcome",
      variant: "heading",
    },
    {
      id: "action",
      component: "Button",
      children: [],
      label: "Continue",
    },
  ];

  it("maps component instances to renderer elements", () => {
    expect(componentInstancesToSpec(components)).toEqual({
      root: "layout",
      elements: {
        layout: {
          type: "Stack",
          props: { direction: "vertical", gap: "md" },
          children: ["title", "action"],
        },
        title: {
          type: "Text",
          props: { text: "Welcome", variant: "heading" },
        },
        action: {
          type: "Button",
          props: { label: "Continue" },
          children: [],
        },
      },
    });
  });

  it("uses an explicit root id", () => {
    expect(componentInstancesToSpec(components, "title").root).toBe("title");
  });
});
