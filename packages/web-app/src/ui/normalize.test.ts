import { describe, expect, it } from "bun:test";

import { normalizeStreamingSpec } from "./normalize.ts";

describe("normalizeStreamingSpec", () => {
  it("accepts a complete approved spec", () => {
    expect(
      normalizeStreamingSpec({
        root: "root",
        elements: {
          root: { type: "Card", props: {}, children: ["text"] },
          text: { type: "Text", props: { text: "Hello" }, children: [] },
        },
      }),
    ).toEqual({
      root: "root",
      elements: {
        root: { type: "Card", props: {}, children: ["text"] },
        text: { type: "Text", props: { text: "Hello" }, children: [] },
      },
    });
  });

  it("rejects unknown component types", () => {
    expect(
      normalizeStreamingSpec({
        root: "root",
        elements: {
          root: { type: "Image", props: {}, children: [] },
        },
      }),
    ).toBeNull();
  });

  it("rejects missing props", () => {
    expect(
      normalizeStreamingSpec({
        root: "root",
        elements: {
          root: { type: "Card", children: [] },
        },
      }),
    ).toBeNull();
  });

  it("rejects missing child references", () => {
    expect(
      normalizeStreamingSpec({
        root: "root",
        elements: {
          root: { type: "Card", props: {}, children: ["missing"] },
        },
      }),
    ).toBeNull();
  });
});
