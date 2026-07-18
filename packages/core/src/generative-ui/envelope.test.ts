import { describe, expect, it } from "bun:test";

import {
  applyUiUpdate,
  classifyUpdateText,
  normalizeQuestionOption,
  normalizeUiUpdate,
  parseUpdateLine,
  uiUpdateZone,
} from "./envelope.ts";
import type { UiSpec } from "./types.ts";

const textUpdate = {
  type: "ui" as const,
  rootId: "root",
  components: [{ id: "root", component: "Text", text: "Hello" }],
};

describe("parseUpdateLine", () => {
  it("parses valid updates through the catalog validator", () => {
    expect(parseUpdateLine(JSON.stringify(textUpdate))).toEqual(textUpdate);
    expect(parseUpdateLine('{"type":"message","text":"hi"}')).toEqual({
      type: "message",
      text: "hi",
    });
  });

  it("drops malformed and off-catalog updates", () => {
    expect(parseUpdateLine("not json")).toBeNull();
    expect(
      parseUpdateLine(
        JSON.stringify({ type: "ui", components: [{ id: "x", component: "Unknown" }] }),
      ),
    ).toBeNull();
  });
});

describe("normalizeUiUpdate", () => {
  it("accepts canonical v2 updates", () => {
    expect(normalizeUiUpdate(textUpdate)).toEqual(textUpdate);
  });

  it("rejects the legacy spec envelope", () => {
    expect(normalizeUiUpdate({ type: "ui", spec: { root: "root", elements: {} } })).toBeNull();
  });
});

describe("applyUiUpdate", () => {
  it("routes update variants", () => {
    const seen: string[] = [];
    let spec: UiSpec | undefined;
    const handlers = {
      onMessage: (text: string) => seen.push(text),
      onSpec: (value: UiSpec) => {
        spec = value;
      },
      onError: (message: string) => seen.push(message),
      onMainAgentActivity: () => seen.push("main"),
      onSubagentActivity: () => seen.push("subagent"),
    };

    applyUiUpdate({ type: "message", text: "hi" }, handlers);
    applyUiUpdate(textUpdate, handlers);
    applyUiUpdate({ type: "error", message: "boom" }, handlers);
    applyUiUpdate({ type: "main_agent_activity", event: "started" }, handlers);
    applyUiUpdate(
      { type: "subagent_activity", subagentName: "researcher", event: "completed" },
      handlers,
    );

    expect(seen).toEqual(["hi", "boom", "main", "subagent"]);
    expect(spec).toEqual({ components: textUpdate.components, rootId: "root" });
  });
});

describe("classification helpers", () => {
  it("retains diagnostics for invalid UI candidates", () => {
    const result = classifyUpdateText(
      JSON.stringify({ type: "ui", components: [{ id: "x", component: "Unknown" }] }),
    );
    expect(result.accepted).toEqual([]);
    expect(result.rejectedUiCandidates[0]?.issues[0]?.code).toBe("unknown_component");
  });

  it("normalizes options and routes zones", () => {
    expect(normalizeQuestionOption("One")).toEqual({ label: "One" });
    expect(normalizeQuestionOption({ label: "One", recommended: true })).toEqual({
      label: "One",
      recommended: true,
    });
    expect(uiUpdateZone(textUpdate)).toBe("interaction");
    expect(uiUpdateZone({ type: "message", text: "hi" })).toBe("chat");
  });
});
