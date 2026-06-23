import { describe, expect, it } from "bun:test";

import { parseUpdateText, StreamingLineBuffer } from "./envelope.ts";

describe("StreamingLineBuffer", () => {
  it("emits a complete line when its trailing newline arrives", () => {
    const buffer = new StreamingLineBuffer();
    expect(buffer.push('{"type":"message","text":"Hel')).toEqual([]);
    expect(buffer.push('lo"}\n')).toEqual(['{"type":"message","text":"Hello"}']);
  });

  it("holds the incomplete tail across pushes", () => {
    const buffer = new StreamingLineBuffer();
    expect(buffer.push("first\nsec")).toEqual(["first"]);
    expect(buffer.push("ond\n")).toEqual(["second"]);
  });

  it("emits multiple lines from a single chunk", () => {
    const buffer = new StreamingLineBuffer();
    expect(buffer.push("a\nb\nc\n")).toEqual(["a", "b", "c"]);
  });

  it("returns the trailing fragment without a newline as the new tail", () => {
    const buffer = new StreamingLineBuffer();
    expect(buffer.push("a\nb\nc")).toEqual(["a", "b"]);
    expect(buffer.push("d\n")).toEqual(["cd"]);
  });

  it("treats empty chunks as a no-op", () => {
    const buffer = new StreamingLineBuffer();
    expect(buffer.push("")).toEqual([]);
    expect(buffer.push("x\n")).toEqual(["x"]);
  });

  it("flush emits a trailing line that never received a newline", () => {
    const buffer = new StreamingLineBuffer();
    buffer.push("first\n");
    expect(buffer.push('{"type":"message","text":"tail"}')).toEqual([]);
    expect(buffer.flush()).toEqual(['{"type":"message","text":"tail"}']);
  });

  it("flush returns an empty array when nothing is buffered", () => {
    const buffer = new StreamingLineBuffer();
    expect(buffer.flush()).toEqual([]);
  });

  it("flush resets the buffer so a second call is a no-op", () => {
    const buffer = new StreamingLineBuffer();
    buffer.push("first\nsecond");
    expect(buffer.flush()).toEqual(["second"]);
    expect(buffer.flush()).toEqual([]);
  });
});

describe("parseUpdateText", () => {
  it("parses each valid NDJSON line into a UiUpdate", () => {
    const text = [
      '{"type":"message","text":"hi"}',
      '{"type":"ui","spec":{"root":"root","elements":{}}}',
    ].join("\n");

    expect(parseUpdateText(text)).toEqual([
      { type: "message", text: "hi" },
      { type: "ui", spec: { root: "root", elements: {} } },
    ]);
  });

  it("skips blank lines", () => {
    const text = '\n{"type":"message","text":"hi"}\n\n';
    expect(parseUpdateText(text)).toEqual([{ type: "message", text: "hi" }]);
  });

  it("skips malformed JSON lines", () => {
    const text = 'not json\n{"type":"message","text":"ok"}\n{bad';
    expect(parseUpdateText(text)).toEqual([{ type: "message", text: "ok" }]);
  });

  it("skips lines whose update type is unknown", () => {
    const text = '{"type":"other","text":"hi"}\n{"type":"message","text":"ok"}';
    expect(parseUpdateText(text)).toEqual([{ type: "message", text: "ok" }]);
  });

  it("applies the normalizeSpec hook to ui specs", () => {
    const normalizeSpec = () => ({ root: "ok", elements: {} }) as const;
    const text = '{"type":"ui","spec":{"root":"raw"}}';
    expect(parseUpdateText(text, normalizeSpec)).toEqual([
      { type: "ui", spec: { root: "ok", elements: {} } },
    ]);
  });

  it("drops ui updates when the normalizeSpec hook rejects them", () => {
    const rejectAll = () => null;
    const text = '{"type":"ui","spec":{"root":"raw"}}';
    expect(parseUpdateText(text, rejectAll)).toEqual([]);
  });
});
