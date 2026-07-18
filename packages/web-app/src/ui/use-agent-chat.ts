"use client";

import type {
  A2UIValidationResult,
  ModelUiOutput,
  UiUpdate,
} from "@deep-agent-template/core/generative-ui/types";
import type { Spec } from "@json-render/core";
import { type FormEvent, useCallback, useMemo, useRef, useState } from "react";

import { componentInstancesToSpec } from "./spec-adapter.ts";
import type { ChatMessage } from "./types.ts";
import { parseClientUpdateLine, validateClientModelUiOutput } from "./validate-spec.ts";

export type QualificationQuestion = Extract<UiUpdate, { type: "question" }>["question"];
export type MainAgentActivityUpdate = Extract<UiUpdate, { type: "main_agent_activity" }>;
export type SubagentActivityUpdate = Extract<UiUpdate, { type: "subagent_activity" }>;

export type DisplayMessage = ChatMessage & {
  id: string;
  answer?: string;
  answered?: boolean;
  question?: QualificationQuestion;
  streaming?: boolean;
};

export type DisplayAgentActivity = (MainAgentActivityUpdate | SubagentActivityUpdate) & {
  id: string;
  rawText?: string;
};

export type DisplayUiSpec = {
  id: string;
  spec: Spec;
};

type AgentChatUpdateHandlers = {
  onMessage: (text: string) => void;
  onQuestion?: (question: QualificationQuestion) => void;
  onSpec: (spec: Spec) => void;
  onError: (message: string) => void;
  onMainAgentActivity?: (update: MainAgentActivityUpdate) => void;
  onSubagentActivity?: (update: SubagentActivityUpdate) => void;
};

export function applyAgentChatUpdate(update: UiUpdate, handlers: AgentChatUpdateHandlers): void {
  switch (update.type) {
    case "message":
      handlers.onMessage(update.text);
      break;
    case "question":
      handlers.onQuestion?.(update.question);
      break;
    case "ui":
      handlers.onSpec(componentInstancesToSpec(update.components, update.rootId));
      break;
    case "error":
      handlers.onError(update.message);
      break;
    case "main_agent_activity":
      handlers.onMainAgentActivity?.(update);
      break;
    case "subagent_activity":
      handlers.onSubagentActivity?.(update);
      break;
  }
}

export function applyAgentChatLine(
  line: string,
  handlers: AgentChatUpdateHandlers,
): A2UIValidationResult {
  const result = parseClientUpdateLine(line);
  if (result.ok) {
    applyAgentChatUpdate(result.update, handlers);
  } else {
    handlers.onError(result.issues[0]?.message ?? "UI update was rejected by the validator.");
  }
  return result;
}

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
    if (activity.subagentRunId || update.subagentRunId) {
      return activity.subagentRunId === update.subagentRunId;
    }
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

export type AgentChat = {
  messages: DisplayMessage[];
  visibleMessages: DisplayMessage[];
  agentActivity: DisplayAgentActivity[];
  assistantText: string;
  input: string;
  uiSpecs: DisplayUiSpec[];
  latestSpecs: Spec[];
  latestSpec: Spec | null;
  error: string | null;
  loading: boolean;
  canSubmit: boolean;
  setInput: (value: string) => void;
  submitAnswer: (questionId: string, answer: string) => void;
  submitMessage: (event: FormEvent<HTMLFormElement>) => Promise<void>;
};

function appendChunk(current: string, delta: string): string {
  return `${current}${delta}`;
}

export function previewAssistantTextFromActivity(raw: string): string {
  let modelOutput: ModelUiOutput | null = null;
  try {
    const parsedOutput: unknown = JSON.parse(raw);
    const result = validateClientModelUiOutput(parsedOutput);
    modelOutput = result.ok ? result.output : null;
  } catch {
    // The streamed value may be incomplete or use the legacy line format.
  }
  const updates =
    modelOutput?.updates ??
    raw
      .split("\n")
      .map((line) => parseClientUpdateLine(line.trim()))
      .flatMap((result) => (result.ok ? [result.update] : []));
  const parsedMessages = updates
    .flatMap((update) =>
      update &&
      typeof update === "object" &&
      "type" in update &&
      update.type === "message" &&
      "text" in update &&
      typeof update.text === "string"
        ? [update.text]
        : [],
    )
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

function updateAssistantMessage(
  current: DisplayMessage[],
  text: string,
  id: string,
  combine: (existing: string, incoming: string) => string,
): DisplayMessage[] {
  const index = current.findIndex((message) => message.id === id);
  if (index === -1) {
    return [...current, { role: "assistant", content: text, id, streaming: true }];
  }

  return current.map((message, messageIndex) =>
    messageIndex === index
      ? { ...message, content: combine(message.content, text), streaming: true }
      : message,
  );
}

export function appendAssistantChunk(
  current: DisplayMessage[],
  text: string,
  id: string,
): DisplayMessage[] {
  return updateAssistantMessage(current, text, id, appendChunk);
}

export function replaceAssistantMessage(
  current: DisplayMessage[],
  text: string,
  id: string,
): DisplayMessage[] {
  return updateAssistantMessage(current, text, id, () => text);
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

export function formatQuestionAnswers(
  messages: readonly DisplayMessage[],
  answers: ReadonlyMap<string, string>,
  questionIds: ReadonlySet<string>,
): string {
  const lines = messages.flatMap((message) => {
    const question = message.question;
    const answer = question ? answers.get(question.id)?.trim() : undefined;
    return question && questionIds.has(question.id) && answer
      ? [`- ${question.prompt}: ${answer}`]
      : [];
  });

  return lines.length > 0 ? `Here are my answers:\n${lines.join("\n")}` : "";
}

export function appendUiSpec(
  current: readonly DisplayUiSpec[],
  spec: Spec,
  id = createId(),
): DisplayUiSpec[] {
  const existingIndex = current.findIndex((entry) => entry.spec.root === spec.root);
  if (existingIndex === -1) {
    return [...current, { id, spec }];
  }
  return current.map((entry, index) => (index === existingIndex ? { ...entry, spec } : entry));
}

export function useAgentChat(): AgentChat {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [agentActivity, setAgentActivity] = useState<DisplayAgentActivity[]>([]);
  const [input, setInput] = useState("");
  const [uiSpecs, setUiSpecs] = useState<DisplayUiSpec[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [answeredQuestionIds, setAnsweredQuestionIds] = useState<Set<string>>(() => new Set());
  const [openQuestionIds, setOpenQuestionIds] = useState<Set<string>>(() => new Set());
  const [questionAnswers, setQuestionAnswers] = useState<Map<string, string>>(() => new Map());
  const sessionIdRef = useRef<string>(createId());
  const loadingRef = useRef(false);

  const hasOpenQuestions = openQuestionIds.size > 0;
  const allOpenQuestionsAnswered = [...openQuestionIds].every((id) =>
    Boolean(questionAnswers.get(id)?.trim()),
  );
  const canSubmit =
    !loading && (hasOpenQuestions ? allOpenQuestionsAnswered : input.trim().length > 0);

  const visibleMessages = useMemo<DisplayMessage[]>(
    () =>
      messages.map((message) => ({
        ...message,
        answer: message.question ? questionAnswers.get(message.question.id) : undefined,
        answered: message.question ? answeredQuestionIds.has(message.question.id) : undefined,
      })),
    [answeredQuestionIds, messages, questionAnswers],
  );

  const assistantText = useMemo(
    () =>
      messages.findLast((message) => message.role === "assistant" && message.streaming)?.content ??
      "",
    [messages],
  );
  const latestSpecs = useMemo(() => uiSpecs.map((entry) => entry.spec), [uiSpecs]);
  const latestSpec = latestSpecs.at(-1) ?? null;

  const submitText = useCallback(async (rawMessage: string) => {
    const message = rawMessage.trim();
    if (!message || loadingRef.current) {
      return;
    }

    loadingRef.current = true;
    setMessages((current) => [...current, { role: "user", content: message, id: createId() }]);
    setUiSpecs([]);
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
    const handlers: AgentChatUpdateHandlers = {
      onMessage: (text) => {
        streamingAssistantId ??= createId();
        const assistantId = streamingAssistantId;
        setMessages((current) => appendAssistantChunk(current, text, assistantId));
      },
      onQuestion: (question) => {
        finishStreamingAssistant();
        setOpenQuestionIds((current) => new Set(current).add(question.id));
        setQuestionAnswers((current) => {
          const next = new Map(current);
          next.delete(question.id);
          return next;
        });
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
        setUiSpecs((current) => appendUiSpec(current, spec));
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
        const key = update.subagentRunId ?? update.subagentName;
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
          applyAgentChatLine(trimmed, handlers);
        }
      }

      const tail = buffered.trim();
      if (tail) {
        applyAgentChatLine(tail, handlers);
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

  const submitAnswer = useCallback((questionId: string, answer: string) => {
    if (!answer.trim() || loadingRef.current) {
      return;
    }
    setAnsweredQuestionIds((current) => new Set(current).add(questionId));
    setQuestionAnswers((current) => new Map(current).set(questionId, answer.trim()));
  }, []);

  const submitMessage = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (loadingRef.current) {
        return;
      }

      if (openQuestionIds.size > 0) {
        const message = formatQuestionAnswers(messages, questionAnswers, openQuestionIds);
        if (!message) {
          return;
        }
        setOpenQuestionIds(new Set());
        setQuestionAnswers(new Map());
        await submitText(message);
        return;
      }

      await submitText(input);
    },
    [input, messages, openQuestionIds, questionAnswers, submitText],
  );

  return {
    messages,
    visibleMessages,
    agentActivity,
    assistantText,
    input,
    uiSpecs,
    latestSpecs,
    latestSpec,
    error,
    loading,
    canSubmit,
    setInput,
    submitAnswer,
    submitMessage,
  };
}
