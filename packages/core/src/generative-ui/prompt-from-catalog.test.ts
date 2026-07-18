import { describe, expect, it } from "bun:test";
import { CORE_PROMPT_TEMPLATES } from "../prompts/index.ts";
import { composeGenerativeUiPrompt, GENERATIVE_UI_JSON_OBJECT_PROMPT } from "./prompt.ts";
import {
  catalogPrompt,
  catalogPromptFromJsonCatalog,
  describeCatalogProps,
  describeComponentTypeUnion,
} from "./prompt-from-catalog.ts";

const expectedPropsBlockTail = `- Button: {"label": string, "action"?: string}
- Card: {"title"?: string}
- ImagePlaceholder: {"alt"?: string, "prompt"?: string}
- ProductCard: {"title": string, "description": string, "imageAlt"?: string, "imagePrompt"?: string}
- ProductGrid: {"heading"?: string}
- Stack: {"direction"?: "row" | "column", "gap"?: "xs" | "sm" | "md" | "lg"}
- Text: {"text": string, "variant"?: "title" | "body" | "muted" | "caption"}
- TextInput: {"label": string, "name": string, "placeholder"?: string, "inputType"?: "text" | "email" | "password"}
- product-card: {"title": string, "description": string, "imageUrl"?: string, "status"?: "streaming" | "complete"}`;

const expectedComponentTypeUnion =
  '"Button" | "Card" | "ImagePlaceholder" | "ProductCard" | "ProductGrid" | "Stack" | "Text" | "TextInput" | "product-card"';

describe("prompt-from-catalog walker", () => {
  it("produces the byte-for-byte legacy prop description block", () => {
    expect(describeCatalogProps()).toBe(expectedPropsBlockTail);
  });

  it("produces the legacy component-type union", () => {
    expect(describeComponentTypeUnion()).toBe(expectedComponentTypeUnion);
  });

  it("substitutes both placeholders into the prompt template", () => {
    const rendered = catalogPromptFromJsonCatalog(CORE_PROMPT_TEMPLATES.jsonRenderCatalog);
    expect(rendered).toContain("Allowed component props:");
    expect(rendered).toContain("- Button: {");
    expect(rendered).toContain("- product-card: {");
    expect(rendered).not.toContain("{{componentPropsCatalog}}");
    expect(rendered).not.toContain("{{componentTypeUnion}}");
  });

  it("describes only the flat A2UI component wire format", () => {
    const template = CORE_PROMPT_TEMPLATES.jsonRenderCatalog;
    const rendered = catalogPromptFromJsonCatalog(template);

    expect(template).toContain("{{componentTypeUnion}}");
    expect(template).toContain("{{componentPropsCatalog}}");
    expect(rendered).toContain('"type":"ui"');
    expect(rendered).toContain('"rootId"?:string');
    expect(rendered).toContain('"components"');
    expect(rendered).toContain("component ID strings only, never nested child objects");
    expect(rendered).toContain("Put component props directly on each component object");
    expect(rendered).toContain(
      "Do not emit a `spec` field, a `root`/`elements` structure, or a `props` wrapper.",
    );
    expect(rendered).not.toContain("JsonRenderSpec");
  });

  it("includes a valid flat multi-component catalog example", () => {
    const rendered = catalogPromptFromJsonCatalog(CORE_PROMPT_TEMPLATES.jsonRenderCatalog);

    expect(rendered).toContain(
      '{"id":"products","component":"ProductGrid","heading":"Featured products","children":["product-1","product-2"]}',
    );
    expect(rendered).toContain(
      '{"id":"product-1","component":"ProductCard","title":"Desk Lamp","description":"A compact adjustable lamp.","imagePrompt":"A compact desk lamp on a clean workspace"}',
    );
    expect(rendered).not.toContain('"children":[{');
  });

  it("exports the rendered catalog prompt", () => {
    expect(catalogPromptFromJsonCatalog(CORE_PROMPT_TEMPLATES.jsonRenderCatalog)).toBe(
      catalogPrompt,
    );
  });

  it("uses the canonical catalog by default and preserves explicit overrides", () => {
    expect(composeGenerativeUiPrompt()).toBe(
      `${GENERATIVE_UI_JSON_OBJECT_PROMPT}\n\n${catalogPrompt.trim()}`,
    );
    expect(composeGenerativeUiPrompt("CUSTOM CATALOG")).toBe(
      `${GENERATIVE_UI_JSON_OBJECT_PROMPT}\n\nCUSTOM CATALOG`,
    );
    expect(composeGenerativeUiPrompt("")).toBe(GENERATIVE_UI_JSON_OBJECT_PROMPT);
  });

  it("reflects catalog changes without code changes", () => {
    // Sanity: every catalog component name appears in the rendered prompt.
    const rendered = describeCatalogProps();
    for (const name of [
      "Button",
      "Card",
      "ImagePlaceholder",
      "ProductCard",
      "ProductGrid",
      "Stack",
      "Text",
      "TextInput",
      "product-card",
    ]) {
      expect(rendered).toContain(`- ${name}:`);
    }
  });

  it("marks required vs optional props correctly", () => {
    const rendered = describeCatalogProps();
    // Button.label is required (no ?), Button.action is optional (?).
    expect(rendered).toContain('"label": string');
    expect(rendered).toContain('"action"?: string');
    expect(rendered).toContain('- product-card: {"title": string');
  });

  it("renders enums as quoted pipe-separated unions", () => {
    const rendered = describeCatalogProps();
    expect(rendered).toContain('"direction"?: "row" | "column"');
    expect(rendered).toContain('"inputType"?: "text" | "email" | "password"');
  });
});
