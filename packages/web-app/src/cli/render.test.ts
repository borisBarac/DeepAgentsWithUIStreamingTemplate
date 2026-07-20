import { describe, expect, it } from "bun:test";

import type { UiUpdate } from "@deep-agent-template/core/generative-ui/types";

import { renderActivitySummary, renderHistory, renderUiSpecs, renderUpdate } from "./render.ts";

function pretty(update: UiUpdate, quiet = false): string[] {
  return renderUpdate(update, { format: "pretty", quiet }).map((line) =>
    line.kind === "pretty" ? line.text : "<ndjson>",
  );
}

describe("renderUpdate — ndjson", () => {
  it("emits one JSON line per update", () => {
    const lines = renderUpdate({ type: "message", text: "hi" }, { format: "ndjson", quiet: false });
    expect(lines).toEqual([{ kind: "ndjson", text: '{"type":"message","text":"hi"}' }]);
  });
});

describe("renderUpdate — pretty", () => {
  it("renders a message as plain text", () => {
    expect(pretty({ type: "message", text: "hi" })).toEqual(["hi"]);
  });

  it("prefixes errors with an exclamation mark", () => {
    expect(pretty({ type: "error", message: "boom" })).toEqual(["! boom"]);
  });

  it("lists multiple-choice options", () => {
    const lines = pretty({
      type: "question",
      question: {
        id: "q1",
        kind: "multiple_choice",
        options: ["A", { label: "B", description: "second", recommended: true }],
        prompt: "Pick one",
      },
    });
    expect(lines).toEqual(["? Pick one", "  [1] A", "  [2] B (recommended) — second"]);
  });

  it("shows the placeholder for open-text questions", () => {
    const lines = pretty({
      type: "question",
      question: { id: "q1", kind: "open_text", prompt: "Name it", placeholder: "type here" },
    });
    expect(lines).toEqual(["? Name it", "  type here"]);
  });

  it("summarizes a UI spec with a header and component lines", () => {
    const lines = pretty({
      type: "ui",
      rootId: "root",
      components: [
        { id: "root", component: "Stack", children: ["a"], gap: "lg" },
        { id: "a", component: "Text", text: "Hello" },
      ],
    });
    expect(lines[0]).toBe("◆ ui root=root (2 components)");
    expect(lines).toContain("    - Stack#root");
    expect(lines).toContain("        gap: lg");
    expect(lines).toContain("        children: a");
  });

  it("formats main-agent activity with event suffix", () => {
    expect(pretty({ type: "main_agent_activity", event: "started" })).toEqual(["• main started"]);
    expect(pretty({ type: "main_agent_activity", event: "delta", text: "thinking" })).toEqual([
      "• main delta — thinking",
    ]);
  });

  it("humanizes subagent names", () => {
    expect(
      pretty({
        type: "subagent_activity",
        subagentName: "general-purpose",
        event: "started",
        task: "find facts",
      }),
    ).toEqual(["• General purpose started — find facts"]);
  });
});

describe("renderUpdate — quiet", () => {
  it("only renders message and error updates", () => {
    expect(
      renderUpdate({ type: "message", text: "hi" }, { format: "pretty", quiet: true }),
    ).toEqual([{ kind: "pretty", text: "hi" }]);
    expect(
      renderUpdate({ type: "error", message: "boom" }, { format: "pretty", quiet: true }),
    ).toEqual([{ kind: "pretty", text: "! boom" }]);
    expect(
      renderUpdate(
        { type: "main_agent_activity", event: "started" },
        { format: "pretty", quiet: true },
      ),
    ).toEqual([]);
  });
});

describe("renderActivitySummary", () => {
  it("formats committed activity entries", () => {
    const lines = renderActivitySummary([
      {
        id: "a",
        type: "main_agent_activity",
        event: "completed",
        rawText: "hello",
        text: "hello",
      },
      {
        id: "b",
        type: "subagent_activity",
        subagentName: "researcher",
        event: "completed",
        rawText: "found",
        text: "found",
      },
    ]);
    expect(lines).toEqual(["  main (completed): hello", "  Researcher (completed): found"]);
  });
});

describe("renderUiSpecs", () => {
  it("renders each spec with root and element types", () => {
    const lines = renderUiSpecs([
      {
        id: "spec-1",
        spec: {
          root: "root",
          elements: {
            root: { type: "Stack", props: { gap: "lg" }, children: ["a"] },
            a: { type: "Text", props: { text: "Hello" } },
          },
        },
      },
    ]);
    expect(lines[0]).toBe("[0] root=root (2 elements)");
    expect(lines).toContain("    - Stack (gap=lg)");
    expect(lines).toContain("    - Text (text=Hello)");
  });
});

describe("renderHistory", () => {
  it("serializes role/content and question prompts", () => {
    const json = renderHistory([
      { id: "u1", role: "user", content: "hello" },
      { id: "a1", role: "assistant", content: "what colour?" },
      {
        id: "q1",
        role: "assistant",
        content: "what colour?",
        question: { id: "colour", kind: "open_text", prompt: "what colour?" },
      },
    ]);
    expect(JSON.parse(json)).toEqual([
      { role: "user", content: "hello", question: null },
      { role: "assistant", content: "what colour?", question: null },
      { role: "assistant", content: "what colour?", question: "what colour?" },
    ]);
  });
});
