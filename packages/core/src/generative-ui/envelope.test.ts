import { describe, expect, it } from "bun:test";

import { applyUiUpdate, normalizeUiUpdate, parseUpdateLine, uiUpdateZone } from "./envelope.ts";

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

  it("parses question updates", () => {
    expect(
      parseUpdateLine(
        '{"type":"question","question":{"id":"audience","prompt":"Who is this for?","kind":"multiple_choice","options":["Founders","Designers"]}}',
      ),
    ).toEqual({
      type: "question",
      question: {
        id: "audience",
        prompt: "Who is this for?",
        kind: "multiple_choice",
        options: ["Founders", "Designers"],
      },
    });
  });

  it("parses subagent activity updates", () => {
    expect(
      parseUpdateLine(
        '{"type":"subagent_activity","subagentName":"researcher","event":"delta","text":"Searching"}',
      ),
    ).toEqual({
      type: "subagent_activity",
      subagentName: "researcher",
      event: "delta",
      text: "Searching",
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
        onQuestion: (question: { prompt: string }) => calls.push(`question:${question.prompt}`),
        onSpec: () => calls.push("spec"),
        onError: (message: string) => calls.push(`error:${message}`),
        onSubagentActivity: (update: { subagentName: string; event: string }) =>
          calls.push(`subagent:${update.subagentName}:${update.event}`),
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

  it("routes question updates to onQuestion", () => {
    const { calls, handlers } = recorder();
    applyUiUpdate(
      {
        type: "question",
        question: {
          id: "constraints",
          prompt: "Any constraints?",
          kind: "open_text",
        },
      },
      handlers,
    );
    expect(calls).toEqual(["question:Any constraints?"]);
  });

  it("routes error updates to onError", () => {
    const { calls, handlers } = recorder();
    applyUiUpdate({ type: "error", message: "boom" }, handlers);
    expect(calls).toEqual(["error:boom"]);
  });

  it("routes subagent activity updates to onSubagentActivity", () => {
    const { calls, handlers } = recorder();
    applyUiUpdate(
      { type: "subagent_activity", subagentName: "researcher", event: "completed" },
      handlers,
    );
    expect(calls).toEqual(["subagent:researcher:completed"]);
  });
});

describe("normalizeUiUpdate", () => {
  it("validates envelope shape and passes messages through", () => {
    expect(normalizeUiUpdate({ type: "message", text: "hi" })).toEqual({
      type: "message",
      text: "hi",
    });
  });

  it("validates multiple-choice question updates", () => {
    expect(
      normalizeUiUpdate({
        type: "question",
        question: {
          id: "audience",
          prompt: "Who is this for?",
          kind: "multiple_choice",
          options: ["Founders", "Designers"],
        },
      }),
    ).toEqual({
      type: "question",
      question: {
        id: "audience",
        prompt: "Who is this for?",
        kind: "multiple_choice",
        options: ["Founders", "Designers"],
      },
    });
  });

  it("rejects multiple-choice questions with too many options", () => {
    expect(
      normalizeUiUpdate({
        type: "question",
        question: {
          id: "audience",
          prompt: "Who is this for?",
          kind: "multiple_choice",
          options: ["A", "B", "C", "D", "E"],
        },
      }),
    ).toBeNull();
  });

  it("validates open-text question updates", () => {
    expect(
      normalizeUiUpdate({
        type: "question",
        question: {
          id: "constraints",
          prompt: "Any constraints?",
          kind: "open_text",
          placeholder: "Budget, deadline, platform",
        },
      }),
    ).toEqual({
      type: "question",
      question: {
        id: "constraints",
        prompt: "Any constraints?",
        kind: "open_text",
        placeholder: "Budget, deadline, platform",
      },
    });
  });

  it("returns null for unknown update types", () => {
    expect(normalizeUiUpdate({ type: "other", text: "hi" })).toBeNull();
  });

  it("validates subagent activity updates", () => {
    expect(
      normalizeUiUpdate({
        type: "subagent_activity",
        subagentName: "analyst",
        event: "started",
        task: "Review the plan",
      }),
    ).toEqual({
      type: "subagent_activity",
      subagentName: "analyst",
      event: "started",
      task: "Review the plan",
    });
  });

  it("rejects subagent activity with unknown events", () => {
    expect(
      normalizeUiUpdate({
        type: "subagent_activity",
        subagentName: "analyst",
        event: "reasoning",
        text: "hidden",
      }),
    ).toBeNull();
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

describe("uiUpdateZone", () => {
  it("keeps subagent activity out of the chat zone", () => {
    expect(
      uiUpdateZone({
        type: "subagent_activity",
        subagentName: "researcher",
        event: "delta",
        text: "Searching",
      }),
    ).toBe("interaction");
  });
});
