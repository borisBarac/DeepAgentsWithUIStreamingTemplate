import { describe, expect, it } from "bun:test";

import { applyUiUpdate, normalizeUiUpdate, parseUpdateLine } from "./envelope.ts";

describe("parseUpdateLine", () => {
  it("parses message updates", () => {
    expect(parseUpdateLine('{"type":"message","text":"hi"}')).toEqual({
      type: "message",
      text: "hi",
    });
  });

  it("parses ui updates", () => {
    const line =
      '{"type":"ui","spec":{"root":"root","elements":{"root":{"type":"Card","props":{},"children":[]}}}}';
    expect(parseUpdateLine(line)).toEqual({
      type: "ui",
      spec: {
        root: "root",
        elements: { root: { type: "Card", props: {}, children: [] } },
      },
    });
  });

  it("parses error updates", () => {
    expect(parseUpdateLine('{"type":"error","message":"boom"}')).toEqual({
      type: "error",
      message: "boom",
    });
  });

  it("returns null for malformed JSON", () => {
    expect(parseUpdateLine("not json")).toBeNull();
  });

  it("returns null for unknown update types", () => {
    expect(parseUpdateLine('{"type":"other","text":"hi"}')).toBeNull();
  });
});

describe("applyUiUpdate", () => {
  function recorder() {
    const calls: string[] = [];
    return {
      calls,
      handlers: {
        onMessage: (text: string) => calls.push(`message:${text}`),
        onSpec: () => calls.push("spec"),
        onError: (message: string) => calls.push(`error:${message}`),
      },
    };
  }

  it("routes message updates to onMessage", () => {
    const { calls, handlers } = recorder();
    applyUiUpdate({ type: "message", text: "hi" }, handlers);
    expect(calls).toEqual(["message:hi"]);
  });

  it("routes ui updates to onSpec", () => {
    const { calls, handlers } = recorder();
    applyUiUpdate({ type: "ui", spec: { root: "root", elements: {} } }, handlers);
    expect(calls).toEqual(["spec"]);
  });

  it("routes error updates to onError", () => {
    const { calls, handlers } = recorder();
    applyUiUpdate({ type: "error", message: "boom" }, handlers);
    expect(calls).toEqual(["error:boom"]);
  });
});

describe("normalizeUiUpdate", () => {
  it("validates envelope shape and passes messages through", () => {
    expect(normalizeUiUpdate({ type: "message", text: "hi" })).toEqual({
      type: "message",
      text: "hi",
    });
  });

  it("returns null for unknown update types", () => {
    expect(normalizeUiUpdate({ type: "other", text: "hi" })).toBeNull();
  });

  it("passes the ui spec through unchanged without a normalizeSpec hook", () => {
    const spec = { root: "root", elements: { root: { type: "Card", props: {}, children: [] } } };
    expect(normalizeUiUpdate({ type: "ui", spec })).toEqual({ type: "ui", spec });
  });

  it("delegates ui spec validation to the normalizeSpec hook", () => {
    const normalizeSpec = (spec: unknown) =>
      spec && typeof spec === "object" && "root" in spec
        ? ({ root: "ok", elements: {} } as const)
        : null;
    expect(normalizeUiUpdate({ type: "ui", spec: { root: "root" } }, normalizeSpec)).toEqual({
      type: "ui",
      spec: { root: "ok", elements: {} },
    });
  });

  it("rejects ui updates when the normalizeSpec hook rejects the spec", () => {
    const rejectAll = () => null;
    expect(normalizeUiUpdate({ type: "ui", spec: { root: "root" } }, rejectAll)).toBeNull();
  });
});
