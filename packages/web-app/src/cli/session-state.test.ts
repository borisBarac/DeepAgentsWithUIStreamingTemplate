import { describe, expect, it } from "bun:test";

import type { UiUpdate } from "@deep-agent-template/core/generative-ui/types";

import { SessionState } from "./session-state.ts";

function applyAll(state: SessionState, updates: UiUpdate[]): void {
  for (const update of updates) {
    state.applyUpdate(update);
  }
  state.finishStreamingAssistant();
}

describe("SessionState", () => {
  it("appends a user message and assistant message", () => {
    const state = new SessionState({ sessionId: "s1" });
    state.beginUserMessage("hi");
    applyAll(state, [{ type: "message", text: "hello back" }]);
    expect(state.messages.map((m) => ({ role: m.role, content: m.content }))).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello back" },
    ]);
  });

  it("accumulates ui specs across updates", () => {
    const state = new SessionState({ sessionId: "s1" });
    applyAll(state, [
      {
        type: "ui",
        rootId: "a",
        components: [{ id: "a", component: "Text", text: "First" }],
      },
    ]);
    expect(state.uiSpecs).toHaveLength(1);
    expect(state.uiSpecs[0]?.spec.root).toBe("a");
  });

  it("appends message text to an in-progress streaming bubble (website parity)", () => {
    // The website's onMessage handler calls appendAssistantChunk, which
    // concatenates with whatever the activity preview already showed.
    // Mirror that exactly: no special-case reset between preview and message.
    const state = new SessionState({ sessionId: "s1" });
    applyAll(state, [
      { type: "main_agent_activity", event: "started" },
      { type: "main_agent_activity", event: "delta", text: '{"type":"message","text":"Hi!"}' },
      { type: "main_agent_activity", event: "completed" },
      { type: "message", text: "Hi!" },
    ]);
    expect(state.messages.at(-1)).toMatchObject({ role: "assistant", content: "Hi!Hi!" });
  });

  it("handles a message update without any preceding activity", () => {
    const state = new SessionState({ sessionId: "s1" });
    applyAll(state, [{ type: "message", text: "Hi!" }]);
    expect(state.messages.at(-1)).toMatchObject({ role: "assistant", content: "Hi!" });
  });

  it("keeps questions open until the next message is composed (website parity)", () => {
    // The website's submitAnswer only stores the answer; openQuestionIds is
    // cleared by submitMessage once it composes the formatQuestionAnswers
    // payload. Mirror that: recordAnswer stores, composeNextMessage clears.
    const state = new SessionState({ sessionId: "s1" });
    applyAll(state, [
      {
        type: "question",
        question: {
          id: "colour",
          kind: "multiple_choice",
          options: ["red", "blue"],
          prompt: "Which colour?",
        },
      },
    ]);
    expect(state.hasOpenQuestions()).toBe(true);
    state.recordAnswer("colour", "blue");
    expect(state.hasOpenQuestions()).toBe(true);
    state.composeNextMessage("ignored");
    expect(state.hasOpenQuestions()).toBe(false);
  });

  it("composes a Here-are-my-answers payload for open questions (website parity)", () => {
    const state = new SessionState({ sessionId: "s1" });
    applyAll(state, [
      {
        type: "question",
        question: {
          id: "colour",
          kind: "multiple_choice",
          options: ["red", "blue"],
          prompt: "Which colour?",
        },
      },
      {
        type: "question",
        question: { id: "size", kind: "open_text", prompt: "What size?" },
      },
    ]);
    state.recordAnswer("colour", "blue");
    state.recordAnswer("size", "large");
    const payload = state.composeNextMessage("(ignored)");
    expect(payload).toBe("Here are my answers:\n- Which colour?: blue\n- What size?: large");
    expect(state.openQuestionIds.size).toBe(0);
  });

  it("keeps unanswered clarification questions open", () => {
    const state = new SessionState({ sessionId: "s1" });
    applyAll(state, [
      {
        type: "question",
        question: { id: "colour", kind: "open_text", prompt: "Which colour?" },
      },
      {
        type: "question",
        question: { id: "size", kind: "open_text", prompt: "What size?" },
      },
    ]);

    state.recordAnswer("colour", "blue");

    expect(state.composeNextMessage("ignored")).toBe("Here are my answers:\n- Which colour?: blue");
    expect(state.openQuestionIds).toEqual(new Set(["size"]));
  });

  it("passes through raw text once questions are closed", () => {
    const state = new SessionState({ sessionId: "s1" });
    expect(state.composeNextMessage("hello")).toBe("hello");
  });

  it("exposes errors so the caller can fail the run", () => {
    const state = new SessionState({ sessionId: "s1" });
    applyAll(state, [{ type: "error", message: "boom" }]);
    expect(state.error).toBe("boom");
  });

  it("clears state on reset but keeps the session id", () => {
    const state = new SessionState({ sessionId: "s1" });
    applyAll(state, [{ type: "message", text: "hi" }]);
    state.reset();
    expect(state.messages).toEqual([]);
    expect(state.sessionId).toBe("s1");
  });

  it("invokes the onActivity callback after each activity update", () => {
    const snapshots: number[] = [];
    const state = new SessionState({
      onActivity: (activity) => snapshots.push(activity.length),
      sessionId: "s1",
    });
    applyAll(state, [
      { type: "main_agent_activity", event: "started" },
      { type: "main_agent_activity", event: "delta", text: "thinking" },
      { type: "main_agent_activity", event: "completed" },
    ]);
    expect(snapshots).toEqual([1, 1, 1]);
    expect(state.agentActivity).toHaveLength(1);
  });
});
