"use client";

import {
  applyUiUpdate,
  parseUpdateLine,
  type UiUpdate,
  type UpdateHandlers,
} from "@deep-agent-template/core/generative-ui";
import type { Spec } from "@json-render/core";
import { type FormEvent, useCallback, useMemo, useRef, useState } from "react";

import type { ChatMessage } from "./types.ts";

export type QualificationQuestion = Extract<UiUpdate, { type: "question" }>["question"];
export type MainAgentActivityUpdate = Extract<UiUpdate, { type: "main_agent_activity" }>;
export type SubagentActivityUpdate = Extract<UiUpdate, { type: "subagent_activity" }>;

export type DisplayMessage = ChatMessage & {
  id: string;
  answered?: boolean;
  question?: QualificationQuestion;
  streaming?: boolean;
};

export type DisplayAgentActivity = (MainAgentActivityUpdate | SubagentActivityUpdate) & {
  id: string;
  rawText?: string;
};

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isFinishedActivity(activity: DisplayAgentActivity): boolean {
  return activity.event === "completed" || activity.event === "error";
}

function sameActivityStream(
  activity: DisplayAgentActivity,
  update: MainAgentActivityUpdate | SubagentActivityUpdate,
): boolean {
  if (activity.type !== update.type || isFinishedActivity(activity)) {
    return false;
  }

  if (activity.type === "main_agent_activity" && update.type === "main_agent_activity") {
    return true;
  }

  if (activity.type === "subagent_activity" && update.type === "subagent_activity") {
    return activity.subagentName === update.subagentName;
  }

  return false;
}

function mergeActivity(
  current: DisplayAgentActivity,
  update: MainAgentActivityUpdate | SubagentActivityUpdate,
): DisplayAgentActivity {
  if (current.type === "subagent_activity" && update.type === "subagent_activity") {
    return {
      ...current,
      ...update,
      task: update.task ?? current.task,
      text: update.text ? appendChunk(current.text ?? "", update.text) : current.text,
      message: update.message ?? current.message,
    };
  }

  if (current.type === "main_agent_activity" && update.type === "main_agent_activity") {
    const rawText = update.text
      ? appendChunk(current.rawText ?? current.text ?? "", update.text)
      : current.rawText;
    const preview = rawText ? previewAssistantTextFromActivity(rawText) : current.text;
    return {
      ...current,
      ...update,
      rawText,
      text: preview || undefined,
      message: update.message ?? current.message,
    };
  }

  return { ...current, ...update };
}

export function appendAgentActivity(
  current: DisplayAgentActivity[],
  update: MainAgentActivityUpdate | SubagentActivityUpdate,
  id = createId(),
): DisplayAgentActivity[] {
  const existingById = current.findIndex((activity) => activity.id === id);
  if (existingById !== -1) {
    return current.map((activity, activityIndex) =>
      activityIndex === existingById ? mergeActivity(activity, update) : activity,
    );
  }

  if (update.event === "started") {
    return [...current, { ...update, id }];
  }

  const index = current.findLastIndex((activity) => sameActivityStream(activity, update));
  if (index === -1) {
    return [...current, { ...update, id }];
  }

  return current.map((activity, activityIndex) =>
    activityIndex === index ? mergeActivity(activity, update) : activity,
  );
}

export function appendSubagentActivity(
  current: DisplayAgentActivity[],
  update: SubagentActivityUpdate,
  id = createId(),
): DisplayAgentActivity[] {
  return appendAgentActivity(current, update, id);
}

export type AgentChat = {
  messages: DisplayMessage[];
  visibleMessages: DisplayMessage[];
  agentActivity: DisplayAgentActivity[];
  assistantText: string;
  input: string;
  latestSpec: Spec | null;
  error: string | null;
  loading: boolean;
  canSubmit: boolean;
  setInput: (value: string) => void;
  submitAnswer: (questionId: string, answer: string) => Promise<void>;
  submitMessage: (event: FormEvent<HTMLFormElement>) => Promise<void>;
};

function appendChunk(current: string, delta: string): string {
  return `${current}${delta}`;
}

export function previewAssistantTextFromActivity(raw: string): string {
  const parsedMessages = raw
    .split("\n")
    .map((line) => parseUpdateLine(line.trim()))
    .flatMap((update) => (update?.type === "message" ? [update.text] : []))
    .map((text) => text.trim())
    .filter(Boolean);

  if (parsedMessages.length > 0) {
    return parsedMessages.join("\n");
  }

  const firstStructuredLine = raw.search(/\s*\{/);
  if (firstStructuredLine === 0) {
    return "";
  }

  return (firstStructuredLine === -1 ? raw : raw.slice(0, firstStructuredLine)).trim();
}

export function appendAssistantChunk(
  current: DisplayMessage[],
  text: string,
  id: string,
): DisplayMessage[] {
  const index = current.findIndex((message) => message.id === id);
  if (index === -1) {
    return [...current, { role: "assistant", content: text, id, streaming: true }];
  }

  return current.map((message, messageIndex) =>
    messageIndex === index
      ? { ...message, content: appendChunk(message.content, text), streaming: true }
      : message,
  );
}

export function replaceAssistantMessage(
  current: DisplayMessage[],
  text: string,
  id: string,
): DisplayMessage[] {
  const index = current.findIndex((message) => message.id === id);
  if (index === -1) {
    return [...current, { role: "assistant", content: text, id, streaming: true }];
  }

  return current.map((message, messageIndex) =>
    messageIndex === index ? { ...message, content: text, streaming: true } : message,
  );
}

export function finishAssistantMessage(
  current: DisplayMessage[],
  id: string | null,
): DisplayMessage[] {
  if (!id) {
    return current;
  }

  return current.flatMap((message) => {
    if (message.id !== id) {
      return [message];
    }

    const content = message.content.trim();
    return content ? [{ ...message, content, streaming: undefined }] : [];
  });
}

export function useAgentChat(): AgentChat {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [agentActivity, setAgentActivity] = useState<DisplayAgentActivity[]>([]);
  const [input, setInput] = useState("");
  const [latestSpec, setLatestSpec] = useState<Spec | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [answeredQuestionIds, setAnsweredQuestionIds] = useState<Set<string>>(() => new Set());
  const sessionIdRef = useRef<string>(createId());
  const loadingRef = useRef(false);

  const canSubmit = input.trim().length > 0 && !loading;

  const visibleMessages = useMemo<DisplayMessage[]>(
    () =>
      messages.map((message) => ({
        ...message,
        answered: message.question ? answeredQuestionIds.has(message.question.id) : undefined,
      })),
    [answeredQuestionIds, messages],
  );

  const assistantText = useMemo(
    () =>
      messages.findLast((message) => message.role === "assistant" && message.streaming)?.content ??
      "",
    [messages],
  );

  const submitText = useCallback(async (rawMessage: string) => {
    const message = rawMessage.trim();
    if (!message || loadingRef.current) {
      return;
    }

    loadingRef.current = true;
    setMessages((current) => [...current, { role: "user", content: message, id: createId() }]);
    setError(null);
    setInput("");
    setLoading(true);

    let streamingAssistantId: string | null = null;
    let streamingAssistantRawText = "";
    let mainActivityId: string | null = null;
    const activeSubagentActivityIds = new Map<string, string>();
    const finishedSubagentActivityKeys = new Set<string>();
    const finishStreamingAssistant = () => {
      const assistantId = streamingAssistantId;
      streamingAssistantId = null;
      streamingAssistantRawText = "";
      setMessages((current) => finishAssistantMessage(current, assistantId));
    };
    const handlers: UpdateHandlers = {
      onMessage: (text) => {
        streamingAssistantId ??= createId();
        const assistantId = streamingAssistantId;
        setMessages((current) => replaceAssistantMessage(current, text, assistantId));
      },
      onQuestion: (question) => {
        finishStreamingAssistant();
        setAnsweredQuestionIds((current) => {
          if (!current.has(question.id)) {
            return current;
          }
          const next = new Set(current);
          next.delete(question.id);
          return next;
        });
        setMessages((current) => [
          ...current,
          {
            role: "assistant",
            content: question.prompt,
            id: createId(),
            question,
          },
        ]);
      },
      onSpec: (spec) => {
        setLatestSpec(spec);
      },
      onError: (errorMessage) => setError(errorMessage),
      onMainAgentActivity: (update) => {
        if (update.event === "delta" && update.text) {
          streamingAssistantRawText += update.text;
          const preview = previewAssistantTextFromActivity(streamingAssistantRawText);
          if (preview) {
            streamingAssistantId ??= createId();
            const assistantId = streamingAssistantId;
            setMessages((current) => replaceAssistantMessage(current, preview, assistantId));
          }
        }
        if (update.event === "completed") {
          streamingAssistantRawText = "";
        }
        if (update.event === "started") {
          mainActivityId ??= createId();
        }
        const activityId = mainActivityId ?? createId();
        setAgentActivity((current) => appendAgentActivity(current, update, activityId));
      },
      onSubagentActivity: (update) => {
        const key = update.subagentName;
        if (update.event === "started") {
          if (!activeSubagentActivityIds.has(key) || finishedSubagentActivityKeys.has(key)) {
            activeSubagentActivityIds.set(key, createId());
            finishedSubagentActivityKeys.delete(key);
          }
        }
        const activityId = activeSubagentActivityIds.get(key) ?? createId();
        setAgentActivity((current) => appendAgentActivity(current, update, activityId));
        if (update.event === "completed" || update.event === "error") {
          finishedSubagentActivityKeys.add(key);
        }
      },
    };

    try {
      const response = await fetch("/api/agent", {
        body: JSON.stringify({
          includeSubagentActivity: true,
          message,
          sessionId: sessionIdRef.current,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      if (!response.ok || !response.body) {
        throw new Error(`Request failed with status ${response.status}.`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffered = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffered += decoder.decode(value, { stream: true });
        const lines = buffered.split("\n");
        buffered = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            continue;
          }
          const update = parseUpdateLine(trimmed);
          if (update) {
            applyUiUpdate(update, handlers);
          }
        }
      }

      const tail = buffered.trim();
      if (tail) {
        const update = parseUpdateLine(tail);
        if (update) {
          applyUiUpdate(update, handlers);
        }
      }

      finishStreamingAssistant();
    } catch (caught) {
      finishStreamingAssistant();
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, []);

  const submitAnswer = useCallback(
    async (questionId: string, answer: string) => {
      if (!answer.trim() || loadingRef.current) {
        return;
      }
      setAnsweredQuestionIds((current) => new Set(current).add(questionId));
      await submitText(answer);
    },
    [submitText],
  );

  const submitMessage = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      await submitText(input);
    },
    [input, submitText],
  );

  return {
    messages,
    visibleMessages,
    agentActivity,
    assistantText,
    input,
    latestSpec,
    error,
    loading,
    canSubmit,
    setInput,
    submitAnswer,
    submitMessage,
  };
}
