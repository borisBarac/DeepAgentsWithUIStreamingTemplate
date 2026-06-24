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

export type DisplayMessage = ChatMessage & {
  id: string;
  answered?: boolean;
  question?: QualificationQuestion;
};

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export type AgentChat = {
  messages: DisplayMessage[];
  visibleMessages: DisplayMessage[];
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

const STREAMING_MESSAGE_ID = "streaming";

export function useAgentChat(): AgentChat {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [assistantText, setAssistantText] = useState("");
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
      assistantText
        ? [
            ...messages.map((message) => ({
              ...message,
              answered: message.question ? answeredQuestionIds.has(message.question.id) : undefined,
            })),
            { role: "assistant", content: assistantText, id: STREAMING_MESSAGE_ID },
          ]
        : messages.map((message) => ({
            ...message,
            answered: message.question ? answeredQuestionIds.has(message.question.id) : undefined,
          })),
    [answeredQuestionIds, assistantText, messages],
  );

  const submitText = useCallback(async (rawMessage: string) => {
    const message = rawMessage.trim();
    if (!message || loadingRef.current) {
      return;
    }

    loadingRef.current = true;
    setMessages((current) => [...current, { role: "user", content: message, id: createId() }]);
    setAssistantText("");
    setError(null);
    setInput("");
    setLoading(true);

    let streamedText = "";
    const commitAssistantText = () => {
      const text = streamedText.trim();
      if (!text) {
        return;
      }
      setMessages((current) => [...current, { role: "assistant", content: text, id: createId() }]);
      streamedText = "";
      setAssistantText("");
    };
    const handlers: UpdateHandlers = {
      onMessage: (text) => {
        streamedText = streamedText ? `${streamedText}\n${text}` : text;
        setAssistantText(streamedText);
      },
      onQuestion: (question) => {
        commitAssistantText();
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
        commitAssistantText();
        setLatestSpec(spec);
      },
      onError: (errorMessage) => setError(errorMessage),
    };

    try {
      const response = await fetch("/api/agent", {
        body: JSON.stringify({ message, sessionId: sessionIdRef.current }),
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

      commitAssistantText();
    } catch (caught) {
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
