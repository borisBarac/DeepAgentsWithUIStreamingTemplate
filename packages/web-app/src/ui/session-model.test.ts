import { describe, expect, it } from "bun:test";

import {
  appendAgentActivity,
  appendAssistantChunk,
  appendUiSpec,
  applyAgentChatLine,
  applyAgentChatUpdate,
  type DisplayMessage,
  finishAssistantMessage,
  formatQuestionAnswers,
  previewAssistantTextFromActivity,
  previewSubagentTextFromActivity,
  reduceMainAgentActivity,
  replaceAssistantMessage,
} from "./session-model.ts";

describe("generative UI state", () => {
  it("does not apply an invalid UI line and reports its first issue", () => {
    const specs: unknown[] = [];
    const errors: string[] = [];
    const result = applyAgentChatLine(
      JSON.stringify({
        type: "ui",
        components: [{ id: "demo", component: "Text", text: "Demo", extra: true }],
      }),
      {
        onMessage: () => {},
        onSpec: (spec) => specs.push(spec),
        onError: (message) => errors.push(message),
      },
    );

    expect(result.ok).toBe(false);
    expect(specs).toEqual([]);
    expect(errors).toEqual(['Component "Text" props did not match the catalog schema.']);
  });

  it("translates component instances before handling a spec", () => {
    const received: unknown[] = [];

    applyAgentChatUpdate(
      {
        type: "ui",
        rootId: "content",
        components: [
          { id: "shell", component: "Stack", children: ["content"], gap: "lg" },
          { id: "content", component: "Text", text: "Ready" },
        ],
      },
      {
        onMessage: () => {},
        onSpec: (spec) => {
          received.push(spec);
        },
        onError: () => {},
      },
    );

    expect(received).toEqual([
      {
        root: "content",
        elements: {
          shell: { type: "Stack", props: { gap: "lg" }, children: ["content"] },
          content: { type: "Text", props: { text: "Ready" } },
        },
      },
    ]);
  });

  it("routes non-UI update variants to their client handlers", () => {
    const received: string[] = [];
    const handlers = {
      onMessage: (text: string) => received.push(`message:${text}`),
      onQuestion: () => received.push("question"),
      onSpec: () => received.push("spec"),
      onError: (message: string) => received.push(`error:${message}`),
      onMainAgentActivity: () => received.push("main"),
      onSubagentActivity: () => received.push("subagent"),
    };

    applyAgentChatUpdate({ type: "message", text: "Hello" }, handlers);
    applyAgentChatUpdate(
      { type: "question", question: { id: "q", prompt: "Why?", kind: "open_text" } },
      handlers,
    );
    applyAgentChatUpdate({ type: "error", message: "Failed" }, handlers);
    applyAgentChatUpdate({ type: "main_agent_activity", event: "started" }, handlers);
    applyAgentChatUpdate(
      { type: "subagent_activity", subagentName: "researcher", event: "started" },
      handlers,
    );

    expect(received).toEqual(["message:Hello", "question", "error:Failed", "main", "subagent"]);
  });

  it("preserves specs with distinct roots in arrival order", () => {
    const first = {
      root: "first",
      elements: {
        first: { type: "Text", props: { text: "First" }, children: [] },
      },
    };
    const second = {
      root: "second",
      elements: {
        second: { type: "Text", props: { text: "Second" }, children: [] },
      },
    };

    expect(appendUiSpec(appendUiSpec([], first, "spec-1"), second, "spec-2")).toEqual([
      { id: "spec-1", spec: first },
      { id: "spec-2", spec: second },
    ]);
  });

  it("replaces a spec with the same root and keeps its display id", () => {
    const first = {
      root: "card",
      elements: {
        card: { type: "Text", props: { text: "Streaming" }, children: [] },
      },
    };
    const complete = {
      root: "card",
      elements: {
        card: { type: "Text", props: { text: "Complete" }, children: [] },
      },
    };

    expect(appendUiSpec(appendUiSpec([], first, "spec-1"), complete, "spec-2")).toEqual([
      { id: "spec-1", spec: complete },
    ]);
  });

  it("keeps product cards until a replacement grid arrives", () => {
    const legacy = {
      root: "legacy",
      elements: {
        legacy: {
          type: "ProductCard",
          props: { title: "Old", description: "Old" },
          children: [],
        },
      },
    };
    const unrelated = {
      root: "note",
      elements: { note: { type: "Text", props: { text: "Keep" }, children: [] } },
    };
    const canonical = {
      root: "products",
      elements: {
        products: { type: "ProductGrid", props: {}, children: ["new"] },
        new: { type: "ProductCard", props: { title: "New", description: "New" }, children: [] },
      },
    };
    const current = [
      { id: "legacy-id", spec: legacy },
      { id: "note-id", spec: unrelated },
    ];

    expect(current).toEqual([
      { id: "legacy-id", spec: legacy },
      { id: "note-id", spec: unrelated },
    ]);

    expect(appendUiSpec(current, canonical, "canonical-id")).toEqual([
      { id: "note-id", spec: unrelated },
      { id: "canonical-id", spec: canonical },
    ]);
  });
});

describe("agent activity state", () => {
  it("keeps workflow-controller feedback out of customer chat while products render", () => {
    const feedback = [
      "WORKFLOW_CONTROLLER_FEEDBACK",
      "phase=execution",
      "requiredAction=execute",
      "Do the required action now. Do not narrate or finalize early.",
    ].join("\n");
    let messages: DisplayMessage[] = [];
    let activity = reduceMainAgentActivity(
      [],
      { type: "main_agent_activity", event: "started" },
      "activity-0",
    );
    activity = reduceMainAgentActivity(
      activity,
      { type: "main_agent_activity", event: "delta", text: feedback },
      "activity-0",
    );

    const specs: unknown[] = [];
    applyAgentChatUpdate(
      {
        type: "ui",
        rootId: "products",
        components: [
          { id: "products", component: "ProductGrid", children: ["one", "two", "three"] },
          { id: "one", component: "ProductCard", title: "One", description: "First" },
          { id: "two", component: "ProductCard", title: "Two", description: "Second" },
          { id: "three", component: "ProductCard", title: "Three", description: "Third" },
        ],
      },
      {
        onMessage: (text) => {
          messages = appendAssistantChunk(messages, text, "assistant-0");
        },
        onSpec: (spec) => specs.push(spec),
        onError: () => {},
      },
    );

    expect(messages).toEqual([]);
    expect(activity[0]?.rawText).toBe(feedback);
    expect(specs).toHaveLength(1);
  });

  it("keeps one main-agent block through started, delta, completed", () => {
    const messages: DisplayMessage[] = [];
    let activity = appendAgentActivity(
      [],
      {
        type: "main_agent_activity",
        event: "started",
      },
      "activity-0",
    );

    activity = appendAgentActivity(
      activity,
      {
        type: "main_agent_activity",
        event: "delta",
        text: "Hello",
      },
      "activity-1",
    );
    activity = appendAgentActivity(
      activity,
      {
        type: "main_agent_activity",
        event: "delta",
        text: " world",
      },
      "activity-2",
    );
    activity = appendAgentActivity(
      activity,
      {
        type: "main_agent_activity",
        event: "completed",
      },
      "activity-3",
    );

    expect(activity).toEqual([
      {
        id: "activity-0",
        type: "main_agent_activity",
        event: "completed",
        rawText: "Hello world",
        text: "Hello world",
      },
    ]);
    expect(messages).toEqual([]);
  });

  it("keeps one subagent block through started, delta, completed", () => {
    let activity = appendAgentActivity(
      [],
      {
        type: "subagent_activity",
        subagentName: "general-purpose",
        event: "started",
        task: "Find public IP",
      },
      "activity-0",
    );

    activity = appendAgentActivity(
      activity,
      {
        type: "subagent_activity",
        subagentName: "general-purpose",
        event: "delta",
        text: "Let",
      },
      "activity-1",
    );
    activity = appendAgentActivity(
      activity,
      {
        type: "subagent_activity",
        subagentName: "general-purpose",
        event: "delta",
        text: " me check",
      },
      "activity-2",
    );
    activity = appendAgentActivity(
      activity,
      {
        type: "subagent_activity",
        subagentName: "general-purpose",
        event: "completed",
      },
      "activity-3",
    );

    expect(activity).toEqual([
      {
        id: "activity-0",
        type: "subagent_activity",
        subagentName: "general-purpose",
        event: "completed",
        task: "Find public IP",
        rawText: "Let me check",
        text: "Let me check",
      },
    ]);
  });

  it("keeps same-name subagent runs separate when run ids differ", () => {
    let activity = appendAgentActivity(
      [],
      {
        type: "subagent_activity",
        subagentRunId: "run-a",
        subagentName: "general-purpose",
        event: "started",
      },
      "activity-a",
    );
    activity = appendAgentActivity(
      activity,
      {
        type: "subagent_activity",
        subagentRunId: "run-b",
        subagentName: "general-purpose",
        event: "started",
      },
      "activity-b",
    );
    activity = appendAgentActivity(activity, {
      type: "subagent_activity",
      subagentRunId: "run-a",
      subagentName: "general-purpose",
      event: "delta",
      text: "First",
    });
    activity = appendAgentActivity(activity, {
      type: "subagent_activity",
      subagentRunId: "run-b",
      subagentName: "general-purpose",
      event: "delta",
      text: "Second",
    });
    activity = appendAgentActivity(activity, {
      type: "subagent_activity",
      subagentRunId: "run-a",
      subagentName: "general-purpose",
      event: "completed",
    });
    activity = appendAgentActivity(activity, {
      type: "subagent_activity",
      subagentRunId: "run-b",
      subagentName: "general-purpose",
      event: "completed",
    });

    expect(activity).toEqual([
      {
        id: "activity-a",
        type: "subagent_activity",
        subagentRunId: "run-a",
        subagentName: "general-purpose",
        event: "completed",
        rawText: "First",
        text: "First",
      },
      {
        id: "activity-b",
        type: "subagent_activity",
        subagentRunId: "run-b",
        subagentName: "general-purpose",
        event: "completed",
        rawText: "Second",
        text: "Second",
      },
    ]);
  });

  it("starts a new block after the previous subagent run is completed", () => {
    let activity = appendAgentActivity(
      [],
      {
        type: "subagent_activity",
        subagentName: "general-purpose",
        event: "started",
      },
      "activity-0",
    );
    activity = appendAgentActivity(
      activity,
      {
        type: "subagent_activity",
        subagentName: "general-purpose",
        event: "completed",
      },
      "activity-1",
    );
    activity = appendAgentActivity(
      activity,
      {
        type: "subagent_activity",
        subagentName: "general-purpose",
        event: "started",
      },
      "activity-2",
    );

    expect(activity).toEqual([
      {
        id: "activity-0",
        type: "subagent_activity",
        subagentName: "general-purpose",
        event: "completed",
      },
      {
        id: "activity-2",
        type: "subagent_activity",
        subagentName: "general-purpose",
        event: "started",
      },
    ]);
  });

  it("reuses an existing activity id instead of appending a duplicate block", () => {
    let activity = appendAgentActivity(
      [],
      {
        type: "main_agent_activity",
        event: "started",
      },
      "activity-0",
    );
    activity = appendAgentActivity(
      activity,
      {
        type: "main_agent_activity",
        event: "started",
      },
      "activity-0",
    );

    expect(activity).toEqual([
      {
        id: "activity-0",
        type: "main_agent_activity",
        event: "started",
      },
    ]);
  });

  it("shows parsed message text instead of raw NDJSON in main-agent activity", () => {
    let activity = appendAgentActivity(
      [],
      {
        type: "main_agent_activity",
        event: "started",
      },
      "activity-0",
    );
    activity = appendAgentActivity(
      activity,
      {
        type: "main_agent_activity",
        event: "delta",
        text: '{"type":"message","text":"Hello!"}',
      },
      "activity-1",
    );
    activity = appendAgentActivity(
      activity,
      {
        type: "main_agent_activity",
        event: "completed",
      },
      "activity-2",
    );

    expect(activity).toEqual([
      {
        id: "activity-0",
        type: "main_agent_activity",
        event: "completed",
        rawText: '{"type":"message","text":"Hello!"}',
        text: "Hello!",
      },
    ]);
  });

  it("strips raw JSON envelopes from subagent activity deltas", () => {
    let activity = appendAgentActivity(
      [],
      {
        type: "subagent_activity",
        subagentName: "clarifier",
        event: "started",
        task: "Clarify scope",
      },
      "activity-0",
    );
    activity = appendAgentActivity(
      activity,
      {
        type: "subagent_activity",
        subagentName: "clarifier",
        event: "delta",
        text: '{"questions":[',
      },
      "activity-1",
    );
    activity = appendAgentActivity(
      activity,
      {
        type: "subagent_activity",
        subagentName: "clarifier",
        event: "delta",
        text: '{"id":"scope","question":"What scope?"}],"reasoningSummary":"Need scope details.","readyToProceed":false}',
      },
      "activity-2",
    );
    activity = appendAgentActivity(
      activity,
      {
        type: "subagent_activity",
        subagentName: "clarifier",
        event: "completed",
      },
      "activity-3",
    );

    const entry = activity[0];
    expect(entry?.rawText).toContain('"questions":');
    // Prose preview comes from reasoningSummary, not the raw JSON dump.
    expect(entry?.text).toBe("Need scope details.");
  });

  it("summarizes a structured clarifier result with a short label when no prose is present", () => {
    expect(
      previewSubagentTextFromActivity(
        JSON.stringify({
          questions: [{ id: "scope", question: "What scope?" }],
          readyToProceed: false,
        }),
      ),
    ).toBe("<structured clarifier output>");
  });

  it("does not duplicate text and message in subagent activity merge", () => {
    let activity = appendAgentActivity(
      [],
      {
        type: "subagent_activity",
        subagentName: "researcher",
        event: "started",
      },
      "activity-0",
    );
    activity = appendAgentActivity(
      activity,
      {
        type: "subagent_activity",
        subagentName: "researcher",
        event: "delta",
        text: "Searching",
      },
      "activity-1",
    );
    // A subsequent update carries a `message` (e.g. error/info) that should
    // NOT be rendered alongside the previewed `text` — text wins, message
    // only fills in when text is empty.
    activity = appendAgentActivity(
      activity,
      {
        type: "subagent_activity",
        subagentName: "researcher",
        event: "delta",
        text: " sources",
        message: "internal note",
      },
      "activity-2",
    );

    const entry = activity[0];
    expect(entry?.text).toBe("Searching sources");
    expect(entry?.message).toBe("internal note");
  });
});

describe("streaming assistant message state", () => {
  it("keeps raw structured lines out of the visible streaming assistant preview", () => {
    expect(
      previewAssistantTextFromActivity(
        [
          "Here is the plan so far.",
          '{"type":"message","text":"Short final answer."}',
          '{"type":"ui","components":[{"id":"demo","component":"Text","text":"Demo"}]}',
        ].join("\n"),
      ),
    ).toBe("Short final answer.");
  });

  it("suppresses partial structured prefixes until a full update can be parsed", () => {
    expect(previewAssistantTextFromActivity('{"type"')).toBe("");
  });

  it("extracts message text from a versioned model output", () => {
    expect(
      previewAssistantTextFromActivity(
        JSON.stringify({
          version: 1,
          updates: [
            { type: "message", text: "Short final answer." },
            {
              type: "ui",
              components: [{ id: "demo", component: "Text", text: "Demo" }],
            },
          ],
        }),
      ),
    ).toBe("Short final answer.");
  });

  it("does not preview an invalid versioned model output", () => {
    expect(
      previewAssistantTextFromActivity(
        JSON.stringify({
          version: 1,
          updates: [{ type: "message", text: "Untrusted", extra: true }],
        }),
      ),
    ).toBe("");
  });

  it("keeps one assistant message with the same id while streaming and after completion", () => {
    const assistantId = "assistant-0";
    let messages: DisplayMessage[] = [{ role: "user", content: "Build a dashboard", id: "user-0" }];

    messages = appendAssistantChunk(messages, "Thinking", assistantId);

    expect(messages.filter((message) => message.role === "assistant")).toEqual([
      {
        role: "assistant",
        content: "Thinking",
        id: assistantId,
        streaming: true,
      },
    ]);

    messages = appendAssistantChunk(messages, " through the layout.", assistantId);
    const streamingAssistant = messages.find((message) => message.id === assistantId);

    expect(streamingAssistant).toEqual({
      role: "assistant",
      content: "Thinking through the layout.",
      id: assistantId,
      streaming: true,
    });
    expect(messages.filter((message) => message.role === "assistant")).toHaveLength(1);

    messages = replaceAssistantMessage(messages, "Thinking through the layout.", assistantId);

    messages = finishAssistantMessage(messages, assistantId);

    expect(messages.filter((message) => message.role === "assistant")).toEqual([
      {
        role: "assistant",
        content: "Thinking through the layout.",
        id: assistantId,
        streaming: undefined,
      },
    ]);
  });

  it("concatenates message update chunks into one assistant bubble", () => {
    const assistantId = "assistant-0";
    let messages: DisplayMessage[] = [];

    messages = appendAssistantChunk(messages, "Hello", assistantId);
    messages = appendAssistantChunk(messages, " world", assistantId);

    expect(messages).toEqual([
      {
        role: "assistant",
        content: "Hello world",
        id: assistantId,
        streaming: true,
      },
    ]);
  });

  it("does not create a duplicate assistant bubble when a completed stream is finalized again", () => {
    const assistantId = "assistant-0";
    let messages = finishAssistantMessage(
      replaceAssistantMessage([], "Final answer.", assistantId),
      assistantId,
    );

    messages = finishAssistantMessage(messages, assistantId);

    expect(messages).toEqual([
      {
        role: "assistant",
        content: "Final answer.",
        id: assistantId,
        streaming: undefined,
      },
    ]);
  });

  it("keeps assistant text separate from question messages", () => {
    const assistantId = "assistant-0";
    let messages = appendAssistantChunk([], "I need one detail first.", assistantId);
    messages = finishAssistantMessage(messages, assistantId);
    messages = [
      ...messages,
      {
        role: "assistant",
        content: "Who is this for?",
        id: "question-0",
        question: {
          id: "audience",
          kind: "multiple_choice",
          options: ["Founders", "Designers"],
          prompt: "Who is this for?",
        },
      },
    ];

    expect(messages).toEqual([
      {
        role: "assistant",
        content: "I need one detail first.",
        id: assistantId,
        streaming: undefined,
      },
      {
        role: "assistant",
        content: "Who is this for?",
        id: "question-0",
        question: {
          id: "audience",
          kind: "multiple_choice",
          options: ["Founders", "Designers"],
          prompt: "Who is this for?",
        },
      },
    ]);
  });

  it("formats every answer from an open clarification round into one reply", () => {
    const messages: DisplayMessage[] = [
      {
        role: "assistant",
        content: "Who is this for?",
        id: "question-0",
        question: {
          id: "audience",
          kind: "multiple_choice",
          options: ["Founders", "Designers"],
          prompt: "Who is this for?",
        },
      },
      {
        role: "assistant",
        content: "What should it do first?",
        id: "question-1",
        question: {
          id: "priority",
          kind: "open_text",
          prompt: "What should it do first?",
        },
      },
    ];

    expect(
      formatQuestionAnswers(
        messages,
        new Map([
          ["audience", "Designers"],
          ["priority", "Plan daily work"],
        ]),
        new Set(["audience", "priority"]),
      ),
    ).toBe(
      "Here are my answers:\n- Who is this for?: Designers\n- What should it do first?: Plan daily work",
    );
  });

  it("reuses the streaming assistant id when final message arrives after activity deltas", () => {
    const assistantId = "assistant-0";
    let messages = appendAssistantChunk([], "I", assistantId);
    messages = appendAssistantChunk(messages, "'ll build this now.", assistantId);

    messages = replaceAssistantMessage(messages, "I'll build this now.", assistantId);
    messages = finishAssistantMessage(messages, assistantId);

    expect(messages).toEqual([
      {
        role: "assistant",
        content: "I'll build this now.",
        id: assistantId,
        streaming: undefined,
      },
    ]);
  });
});
