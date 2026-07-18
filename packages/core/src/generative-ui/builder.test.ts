import { describe, expect, it } from "bun:test";

import {
  asAcceptedUpdate,
  component,
  error as componentError,
  mainAgentActivity,
  message as messageUpdate,
  modelOutput,
  question,
  subagentActivity,
  uiSpec,
} from "./builder.ts";
import { validateUpdate } from "./validator.ts";

describe("builder.message", () => {
  it("constructs a typed message update", () => {
    expect(messageUpdate("hi")).toEqual({ type: "message", text: "hi" });
  });
});

describe("builder.component", () => {
  it("constructs a component instance with props", () => {
    expect(component("btn", "Button", { label: "OK" })).toEqual({
      id: "btn",
      component: "Button",
      label: "OK",
    });
  });

  it("includes children when provided non-empty", () => {
    const c = component("grid", "ProductGrid", { heading: "X" }, ["a", "b"]);
    expect(c.children).toEqual(["a", "b"]);
  });

  it("omits children when empty", () => {
    const c = component("btn", "Button", { label: "OK" });
    expect(c.children).toBeUndefined();
  });
});

describe("builder.uiSpec", () => {
  it("constructs a ui update without rootId when omitted", () => {
    const update = uiSpec([component("t", "Text", { text: "hi" })]);
    expect(update.type).toBe("ui");
    expect(update.rootId).toBeUndefined();
    expect(update.components).toHaveLength(1);
  });

  it("constructs a ui update with rootId when provided", () => {
    const update = uiSpec([component("t", "Text", { text: "hi" })], { rootId: "t" });
    expect(update.rootId).toBe("t");
  });
});

describe("builder.question", () => {
  it("wraps a UiQuestion with type='question'", () => {
    const q = question({
      id: "q1",
      prompt: "Pick one",
      kind: "multiple_choice",
      options: ["a", "b"],
    });
    expect(q.type).toBe("question");
    expect(q.question.id).toBe("q1");
  });
});

describe("builder.componentError", () => {
  it("constructs a canonical error envelope", () => {
    expect(componentError("boom")).toEqual({ type: "error", message: "boom" });
  });
});

describe("builder.mainAgentActivity / subagentActivity", () => {
  it("constructs a main-agent activity with text", () => {
    expect(mainAgentActivity("delta", { text: "thinking" })).toEqual({
      type: "main_agent_activity",
      event: "delta",
      text: "thinking",
    });
  });

  it("constructs a subagent activity with runId and task", () => {
    expect(
      subagentActivity("researcher", "started", {
        subagentRunId: "run-1",
        task: "find docs",
      }),
    ).toEqual({
      type: "subagent_activity",
      subagentName: "researcher",
      event: "started",
      subagentRunId: "run-1",
      task: "find docs",
    });
  });
});

describe("builder.modelOutput", () => {
  it("wraps a list of updates as versioned output", () => {
    expect(modelOutput([messageUpdate("hi")])).toEqual({
      version: 1,
      updates: [{ type: "message", text: "hi" }],
    });
  });

  it("throws on empty updates", () => {
    expect(() => modelOutput([])).toThrow();
  });

  it("throws on more than 32 updates", () => {
    const many = Array.from({ length: 33 }, () => messageUpdate("x"));
    expect(() => modelOutput(many)).toThrow();
  });
});

describe("builder output passes the validator", () => {
  // Round-trip: builders are the canonical way to construct updates; the
  // validator should accept their output without modification.
  it("accepts a built uiSpec", () => {
    const update = uiSpec(
      [
        component("grid", "ProductGrid", { heading: "Concepts" }, ["a"]),
        component("a", "Text", { text: "Hello" }),
      ],
      { rootId: "grid" },
    );
    expect(validateUpdate(update).ok).toBe(true);
  });

  it("accepts a built message", () => {
    expect(validateUpdate(messageUpdate("hi")).ok).toBe(true);
  });

  it("narrows via asAcceptedUpdate without runtime overhead", () => {
    const update = asAcceptedUpdate(messageUpdate("hi"));
    expect(update.type).toBe("message");
  });
});
