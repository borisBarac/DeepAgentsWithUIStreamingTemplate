"use client";

import type { Spec } from "@json-render/core";
import { type FormEvent, useCallback, useMemo, useRef, useState } from "react";

import type {
  AgentChatUpdateHandlers,
  DisplayAgentActivity,
  DisplayMessage,
  DisplayUiSpec,
  QualificationQuestion,
} from "./session-model.ts";
import {
  appendAgentActivity,
  appendAssistantChunk,
  appendUiSpec,
  applyAgentChatLine,
  createId,
  finishAssistantMessage,
  formatQuestionAnswers,
  previewAssistantTextFromActivity,
  replaceAssistantMessage,
} from "./session-model.ts";

export type {
  DisplayAgentActivity,
  DisplayMessage,
  DisplayUiSpec,
  MainAgentActivityUpdate,
  QualificationQuestion,
  SubagentActivityUpdate,
} from "./session-model.ts";
export {
  appendAgentActivity,
  appendAssistantChunk,
  appendUiSpec,
  applyAgentChatLine,
  applyAgentChatUpdate,
  createId,
  finishAssistantMessage,
  formatQuestionAnswers,
  previewAssistantTextFromActivity,
  previewSubagentTextFromActivity,
  replaceAssistantMessage,
} from "./session-model.ts";

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
      onMessage: (text: string) => {
        streamingAssistantId ??= createId();
        const assistantId = streamingAssistantId;
        setMessages((current) => appendAssistantChunk(current, text, assistantId));
      },
      onQuestion: (question: QualificationQuestion) => {
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
      onSpec: (spec: Spec) => {
        setUiSpecs((current) => appendUiSpec(current, spec));
      },
      onError: (errorMessage: string) => setError(errorMessage),
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
