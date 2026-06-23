import { describe, expect, it } from "bun:test";

import { UiUpdateScanner } from "./ui-update-scanner.ts";

describe("UiUpdateScanner", () => {
  it("emits update objects from partial chunks", () => {
    const scanner = new UiUpdateScanner();

    expect(scanner.push('{"updates":[')).toEqual([]);
    expect(scanner.push('{"type":"message","text":"Hel')).toEqual([]);
    expect(scanner.push('lo"}')).toEqual([{ type: "message", text: "Hello" }]);
  });

  it("handles nested objects and arrays", () => {
    const scanner = new UiUpdateScanner();
    const result = scanner.push(
      '{"updates":[{"type":"ui","spec":{"root":"root","elements":{"root":{"type":"Card","props":{},"children":["text"]},"text":{"type":"Text","props":{"text":"Nested"},"children":[]}}}}]}',
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: "ui",
      spec: {
        root: "root",
        elements: {
          root: { type: "Card", props: {}, children: ["text"] },
          text: { type: "Text", props: { text: "Nested" }, children: [] },
        },
      },
    });
  });

  it("keeps escaped quotes inside strings", () => {
    const scanner = new UiUpdateScanner();

    expect(scanner.push('{"updates":[{"type":"message","text":"Say \\"hi\\""}]}')).toEqual([
      { type: "message", text: 'Say "hi"' },
    ]);
  });

  it("does not emit incomplete JSON objects", () => {
    const scanner = new UiUpdateScanner();

    expect(scanner.push('{"updates":[{"type":"message","text":"waiting"')).toEqual([]);
  });
});
