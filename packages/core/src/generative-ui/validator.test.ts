import { describe, expect, it } from "bun:test";

import { catalogLimits } from "./catalog.ts";
import type { ComponentInstance, ModelUiOutput } from "./types.ts";
import { acceptedUiUpdateFixtures, rejectedUiUpdateFixtures } from "./validation-fixtures.ts";
import { validateComponentInstance, validateModelUiOutput, validateUpdate } from "./validator.ts";

const validComponentSamples: Record<string, Record<string, unknown>> = {
  Button: { label: "Continue", action: "demo_action" },
  Card: { title: "Overview" },
  ImagePlaceholder: { alt: "Preview", prompt: "Landscape mockup" },
  ProductCard: {
    title: "Launch Map",
    description: "A planning workspace for design teams.",
    imagePrompt: "Kanban board with milestones",
  },
  ProductGrid: { heading: "Concepts" },
  Stack: { direction: "row", gap: "md" },
  Text: { text: "Hello", variant: "body" },
  TextInput: { label: "Email", name: "email", inputType: "email" },
  "product-card": {
    title: "Launch Map",
    description: "A planning workspace for design teams.",
    imageUrl: "https://example.com/launch-map.png",
    status: "complete",
  },
};

function instance(
  id: string,
  component: string,
  props: Record<string, unknown>,
  children: string[] = [],
): ComponentInstance {
  return { id, component, children, ...props };
}

describe("shared browser validation fixtures", () => {
  for (const fixture of acceptedUiUpdateFixtures) {
    it(`accepts ${fixture.name}`, () => {
      expect(validateUpdate(fixture.value).ok).toBe(true);
    });
  }

  for (const fixture of rejectedUiUpdateFixtures) {
    it(`rejects ${fixture.name} with ${fixture.errorCode}`, () => {
      const result = validateUpdate(fixture.value);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.some((issue) => issue.code === fixture.errorCode)).toBe(true);
      }
    });
  }
});

describe("validateComponentInstance (pass 2)", () => {
  it("accepts every catalog component with valid props", () => {
    for (const [name, props] of Object.entries(validComponentSamples)) {
      const result = validateComponentInstance({ id: "x", component: name, ...props });
      expect(result.ok, `expected ${name} to be valid`).toBe(true);
    }
  });

  it("rejects an unknown component name", () => {
    const result = validateComponentInstance({ id: "x", component: "Mystery" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.code).toBe("unknown_component");
      expect(result.issues[0]?.path).toBe("component");
    }
  });

  it("rejects missing required props", () => {
    const result = validateComponentInstance({ id: "x", component: "Button" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.code === "invalid_envelope")).toBe(true);
    }
  });

  it("rejects additionalProperties when the catalog entry is closed", () => {
    const result = validateComponentInstance({
      id: "x",
      component: "Button",
      label: "OK",
      bogus: "no",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects product-card missing title", () => {
    const result = validateComponentInstance({
      id: "x",
      component: "product-card",
      description: "D",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an invalid product-card imageUrl", () => {
    const result = validateComponentInstance({
      id: "x",
      component: "product-card",
      title: "T",
      description: "D",
      imageUrl: "not-a-url",
    });
    expect(result.ok).toBe(false);
  });
});

describe("validateUpdate — non-ui variants (pass 1 only)", () => {
  it("accepts a message update", () => {
    const result = validateUpdate({ type: "message", text: "Hello" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.update.type).toBe("message");
  });

  it("accepts an error update", () => {
    const result = validateUpdate({ type: "error", message: "Boom" });
    expect(result.ok).toBe(true);
  });

  it("accepts main_agent_activity and subagent_activity", () => {
    expect(validateUpdate({ type: "main_agent_activity", event: "started" }).ok).toBe(true);
    expect(
      validateUpdate({
        type: "subagent_activity",
        subagentName: "researcher",
        event: "completed",
      }).ok,
    ).toBe(true);
  });

  it("rejects an unknown update type", () => {
    const result = validateUpdate({ type: "explosion", text: "Hello" });
    expect(result.ok).toBe(false);
  });

  it("rejects a non-object payload", () => {
    const result = validateUpdate("hello");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Either checkPayload flagged it as a non-object envelope, or ajv did.
      const code = result.issues[0]?.code;
      expect(code === "invalid_payload" || code === "invalid_envelope").toBe(true);
    }
  });
});

describe("validateUpdate — ui variant (passes 1, 2, 3)", () => {
  it("accepts a minimal single-component ui update", () => {
    const result = validateUpdate({
      type: "ui",
      components: [instance("t", "Text", { text: "Hello" })],
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a multi-component ui update with explicit rootId", () => {
    const result = validateUpdate({
      type: "ui",
      rootId: "grid",
      components: [
        instance("grid", "ProductGrid", { heading: "Concepts" }, ["card", "cta"]),
        instance(
          "card",
          "ProductCard",
          {
            title: "Launch Map",
            description: "A planning workspace for design teams.",
            imagePrompt: "Kanban board",
          },
          ["summary"],
        ),
        instance("summary", "Text", { text: "Early concept", variant: "muted" }),
        instance("cta", "Button", { label: "Open details" }),
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects an empty components array", () => {
    const result = validateUpdate({ type: "ui", components: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.code).toBe("empty_components");
    }
  });

  it("rejects more than maxComponents instances", () => {
    const tooMany = Array.from({ length: catalogLimits.maxComponents + 1 }, (_, i) =>
      instance(`t${i}`, "Text", { text: String(i) }),
    );
    const result = validateUpdate({ type: "ui", components: tooMany });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.code).toBe("too_many_components");
    }
  });

  it("rejects a duplicate id", () => {
    const result = validateUpdate({
      type: "ui",
      components: [instance("dup", "Text", { text: "a" }), instance("dup", "Text", { text: "b" })],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.code).toBe("duplicate_id");
    }
  });

  it("rejects a missing child reference", () => {
    const result = validateUpdate({
      type: "ui",
      components: [instance("grid", "ProductGrid", {}, ["ghost"])],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.code).toBe("missing_child");
      expect(result.issues[0]?.path).toContain("children");
    }
  });

  it("rejects a self-reference", () => {
    const result = validateUpdate({
      type: "ui",
      components: [instance("a", "Stack", {}, ["a"])],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.code).toBe("self_reference");
    }
  });

  it("rejects a cycle (tri-color DFS)", () => {
    const result = validateUpdate({
      type: "ui",
      rootId: "a",
      components: [
        instance("a", "Stack", {}, ["b"]),
        instance("b", "Card", {}, ["c"]),
        instance("c", "Text", { text: "Loop" }, ["a"]),
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.code).toBe("cyclic_reference");
    }
  });

  it("rejects an orphan component unreachable from rootId", () => {
    const result = validateUpdate({
      type: "ui",
      rootId: "root",
      components: [
        instance("root", "Text", { text: "Hello" }),
        instance("orphan", "Text", { text: "Hidden" }),
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.code).toBe("unreachable_element");
      expect(result.issues[0]?.path).toContain("orphan");
    }
  });

  it("rejects an unknown component in the list", () => {
    const result = validateUpdate({
      type: "ui",
      components: [instance("x", "Mystery", {})],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.code).toBe("unknown_component");
    }
  });

  it("rejects a rootId that does not exist in components", () => {
    const result = validateUpdate({
      type: "ui",
      rootId: "ghost",
      components: [instance("real", "Text", { text: "Hi" })],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.code).toBe("missing_root_element");
    }
  });

  it("rejects oversized strings anywhere in the payload", () => {
    const result = validateUpdate({
      type: "ui",
      components: [instance("t", "Text", { text: "x".repeat(catalogLimits.maxStringLength + 1) })],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.code).toBe("string_too_long");
    }
  });

  it("rejects oversized JSON payloads", () => {
    const hugeResult = validateUpdate({
      type: "ui",
      components: Array.from({ length: 60 }, (_, i) =>
        instance(`t${i}`, "Text", {
          text: "x".repeat(Math.floor(catalogLimits.maxJsonBytes / 30)),
        }),
      ),
    });
    expect(hugeResult.ok).toBe(false);
    if (!hugeResult.ok) {
      expect(hugeResult.issues[0]?.code).toBe("payload_too_large");
    }
  });
});

describe("validateModelUiOutput", () => {
  it("accepts a valid versioned output with mixed update kinds", () => {
    const output: ModelUiOutput = {
      version: 1,
      updates: [
        { type: "message", text: "Hi" },
        {
          type: "ui",
          components: [instance("t", "Text", { text: "Body" })],
        },
      ],
    };
    const result = validateModelUiOutput(output);
    expect(result.ok).toBe(true);
  });

  it("rejects output missing the version field", () => {
    const result = validateModelUiOutput({ updates: [{ type: "message", text: "Hi" }] });
    expect(result.ok).toBe(false);
  });

  it("rejects output with the wrong version", () => {
    const result = validateModelUiOutput({
      version: 2,
      updates: [{ type: "message", text: "Hi" }],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects output containing an activity update (host-only variant)", () => {
    const result = validateModelUiOutput({
      version: 1,
      updates: [{ type: "main_agent_activity", event: "started" }],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects output with a ui update that fails adjacency", () => {
    const result = validateModelUiOutput({
      version: 1,
      updates: [
        {
          type: "ui",
          components: [instance("a", "Stack", {}, ["b"])],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.code).toBe("missing_child");
      expect(result.issues[0]?.path).toContain("updates[0]");
    }
  });

  it("rejects an empty updates array", () => {
    const result = validateModelUiOutput({ version: 1, updates: [] });
    expect(result.ok).toBe(false);
  });
});
