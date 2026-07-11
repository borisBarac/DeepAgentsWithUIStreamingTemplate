import { describe, expect, it } from "bun:test";

import {
  appendAgentActivity,
  appendAssistantChunk,
  type DisplayMessage,
  finishAssistantMessage,
  formatQuestionAnswers,
  previewAssistantTextFromActivity,
  replaceAssistantMessage,
} from "./use-agent-chat.ts";

describe("agent activity state", () => {
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
        text: "First",
      },
      {
        id: "activity-b",
        type: "subagent_activity",
        subagentRunId: "run-b",
        subagentName: "general-purpose",
        event: "completed",
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
});

describe("streaming assistant message state", () => {
  it("keeps raw structured lines out of the visible streaming assistant preview", () => {
    expect(
      previewAssistantTextFromActivity(
        [
          "Here is the plan so far.",
          '{"type":"message","text":"Short final answer."}',
          '{"type":"ui","spec":{"root":"demo","elements":{}}}',
        ].join("\n"),
      ),
    ).toBe("Short final answer.");
  });

  it("suppresses partial structured prefixes until a full update can be parsed", () => {
    expect(previewAssistantTextFromActivity('{"type"')).toBe("");
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
