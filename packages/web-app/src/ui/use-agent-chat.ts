"use client";

import type { Spec } from "@json-render/core";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getOrCreateGuestId } from "./guest-id.ts";
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
  historyToDisplayMessages,
  reduceMainAgentActivity,
} from "./session-model.ts";

// Persisted across reloads so the server resumes the same thread. The
// Redis session store keeps per-session history; storing the id client-side
// lets a reloaded page reconnect instead of starting over.
const SESSION_ID_STORAGE_KEY = "deep-agent-template.sessionId";

function readStoredSessionId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(SESSION_ID_STORAGE_KEY);
    return typeof value === "string" && value.trim() ? value : null;
  } catch {
    // localStorage may throw in private-browsing modes; fall through to mint.
    return null;
  }
}

function writeStoredSessionId(id: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SESSION_ID_STORAGE_KEY, id);
  } catch {
    // Ignore quota / private-mode write failures; the in-memory ref remains
    // authoritative for the rest of this tab's lifetime.
  }
}

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
  reduceMainAgentActivity,
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
  submitText: (rawMessage: string) => Promise<void>;
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
  const [sessionId] = useState<string>(() => {
    const stored = readStoredSessionId();
    const initial = stored ?? createId();
    if (!stored) writeStoredSessionId(initial);
    return initial;
  });
  const loadingRef = useRef(false);
  const rehydratedRef = useRef(false);

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

  // Rehydrate the message transcript from server-persisted history on mount so
  // a page reload restores the conversation instead of starting empty. Runs
  // once per sessionId; best-effort — errors are swallowed and never block the
  // user. Only populates when messages are still empty so it never clobbers an
  // in-flight or completed turn.
  useEffect(() => {
    if (rehydratedRef.current) return;
    rehydratedRef.current = true;

    let cancelled = false;
    fetch(`/api/session?sessionId=${encodeURIComponent(sessionId)}`, {
      headers: {
        "x-guest-id": getOrCreateGuestId(),
      },
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: unknown) => {
        if (cancelled || !data) return;
        const history = Array.isArray((data as { messages?: unknown[] }).messages)
          ? (data as { messages: unknown[] }).messages
          : [];
        setMessages((current) =>
          current.length === 0 ? historyToDisplayMessages(history) : current,
        );
      })
      .catch(() => {
        // Rehydration is best-effort; never block the user.
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const submitText = useCallback(
    async (rawMessage: string) => {
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
      let mainActivityId: string | null = null;
      const activeSubagentActivityIds = new Map<string, string>();
      const finishedSubagentActivityKeys = new Set<string>();
      const finishStreamingAssistant = () => {
        const assistantId = streamingAssistantId;
        streamingAssistantId = null;
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
          if (update.event === "started") {
            mainActivityId ??= createId();
          }
          const activityId = mainActivityId ?? createId();
          setAgentActivity((current) => reduceMainAgentActivity(current, update, activityId));
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
            sessionId: sessionId,
          }),
          headers: {
            "Content-Type": "application/json",
            // Stable per-browser guest UUID; server returns 400 without it.
            "x-guest-id": getOrCreateGuestId(),
          },
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
    },
    [sessionId],
  );

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
    submitText,
  };
}
