import type { ComponentInstance, UiUpdate } from "@deep-agent-template/core/generative-ui/types";
import type { Spec } from "@json-render/core";
import type {
  DisplayAgentActivity,
  DisplayMessage,
  DisplayUiSpec,
  QualificationQuestion,
} from "../ui/session-model.ts";
import {
  appendAgentActivity,
  appendAssistantChunk,
  appendUiSpec,
  createId,
  finishAssistantMessage,
  formatQuestionAnswers,
  previewAssistantTextFromActivity,
  replaceAssistantMessage,
} from "../ui/session-model.ts";
import { componentInstancesToSpec } from "../ui/spec-adapter.ts";

export type { QualificationQuestion };

/**
 * Stateful driver that owns the per-session model state (`messages`,
 * `uiSpecs`, `agentActivity`, open questions, and the streaming-assistant
 * cursor). This is the non-React equivalent of what `useAgentChat` keeps in
 * `useState`/`useRef` — both consume the same pure functions from
 * `session-model.ts`.
 *
 * The CLI REPL and one-shot mode both drive a session through
 * {@link SessionState.applyUpdate}; the next user message is computed via
 * {@link SessionState.composeNextMessage} so the question-flow matches the
 * website (`formatQuestionAnswers` over every open question).
 */
export type SessionStateOptions = {
  sessionId: string;
  onActivity?: (activity: DisplayAgentActivity[]) => void;
};

export type ApplyResult = {
  kind: "message" | "question" | "ui" | "error" | "activity";
  update: UiUpdate;
};

export class SessionState {
  readonly sessionId: string;
  messages: DisplayMessage[] = [];
  uiSpecs: DisplayUiSpec[] = [];
  agentActivity: DisplayAgentActivity[] = [];
  openQuestionIds = new Set<string>();
  error: string | null = null;

  private streamingAssistantId: string | null = null;
  private streamingAssistantRawText = "";
  private mainActivityId: string | null = null;
  private readonly activeSubagentActivityIds = new Map<string, string>();
  private readonly finishedSubagentActivityKeys = new Set<string>();
  private readonly onActivity?: (activity: DisplayAgentActivity[]) => void;

  constructor(options: SessionStateOptions) {
    this.sessionId = options.sessionId;
    this.onActivity = options.onActivity;
  }

  hasOpenQuestions(): boolean {
    return this.openQuestionIds.size > 0;
  }

  /** Returns true when the next submit must be the question-answer payload. */
  pendingQuestionFlow(): boolean {
    return this.openQuestionIds.size > 0;
  }

  recordAnswer(questionId: string, answer: string): void {
    if (!answer.trim()) return;
    for (const message of this.messages) {
      if (message.question?.id === questionId) {
        message.answer = answer.trim();
        message.answered = true;
      }
    }
  }

  /**
   * Computes the payload to send for the next turn. When questions are open,
   * returns a `formatQuestionAnswers` envelope exactly like the website's
   * `submitMessage` branch; otherwise returns the raw user text.
   */
  composeNextMessage(userText: string): string {
    if (this.openQuestionIds.size > 0) {
      const answers = new Map<string, string>();
      for (const message of this.messages) {
        if (message.question && message.answer) {
          answers.set(message.question.id, message.answer);
        }
      }
      const ids = new Set(this.openQuestionIds);
      this.openQuestionIds = new Set();
      const composed = formatQuestionAnswers(this.messages, answers, ids);
      if (composed) return composed;
    }
    return userText;
  }

  beginUserMessage(text: string): void {
    this.messages = [...this.messages, { role: "user", content: text, id: createId() }];
    this.uiSpecs = [];
    this.error = null;
    this.streamingAssistantId = null;
    this.streamingAssistantRawText = "";
  }

  applyUpdate(update: UiUpdate): ApplyResult {
    switch (update.type) {
      case "message": {
        this.streamingAssistantId ??= createId();
        const id = this.streamingAssistantId;
        this.messages = appendAssistantChunk(this.messages, update.text, id);
        return { kind: "message", update };
      }
      case "question": {
        this.finishStreamingAssistant();
        this.openQuestionIds.add(update.question.id);
        this.messages = [
          ...this.messages,
          {
            role: "assistant",
            content: update.question.prompt,
            id: createId(),
            question: update.question,
          },
        ];
        return { kind: "question", update };
      }
      case "ui": {
        const spec = componentInstancesToSpec(update.components, update.rootId);
        this.uiSpecs = appendUiSpec(this.uiSpecs, spec);
        return { kind: "ui", update };
      }
      case "error": {
        this.error = update.message;
        return { kind: "error", update };
      }
      case "main_agent_activity": {
        this.applyMainActivity(update);
        return { kind: "activity", update };
      }
      case "subagent_activity": {
        this.applySubagentActivity(update);
        return { kind: "activity", update };
      }
    }
  }

  finishStreamingAssistant(): void {
    const id = this.streamingAssistantId;
    this.streamingAssistantId = null;
    this.streamingAssistantRawText = "";
    this.messages = finishAssistantMessage(this.messages, id);
  }

  reset(): void {
    this.messages = [];
    this.uiSpecs = [];
    this.agentActivity = [];
    this.openQuestionIds = new Set();
    this.error = null;
    this.streamingAssistantId = null;
    this.streamingAssistantRawText = "";
    this.mainActivityId = null;
    this.activeSubagentActivityIds.clear();
    this.finishedSubagentActivityKeys.clear();
  }

  private applyMainActivity(update: Extract<UiUpdate, { type: "main_agent_activity" }>): void {
    if (update.event === "delta" && update.text) {
      this.streamingAssistantRawText += update.text;
      const preview = previewAssistantTextFromActivity(this.streamingAssistantRawText);
      if (preview) {
        this.streamingAssistantId ??= createId();
        this.messages = replaceAssistantMessage(this.messages, preview, this.streamingAssistantId);
      }
    }
    if (update.event === "completed") {
      this.streamingAssistantRawText = "";
    }
    if (update.event === "started") {
      this.mainActivityId ??= createId();
    }
    const id = this.mainActivityId ?? createId();
    this.agentActivity = appendAgentActivity(this.agentActivity, update, id);
    this.onActivity?.(this.agentActivity);
  }

  private applySubagentActivity(update: Extract<UiUpdate, { type: "subagent_activity" }>): void {
    const key = update.subagentRunId ?? update.subagentName ?? "";
    if (update.event === "started") {
      if (!this.activeSubagentActivityIds.has(key) || this.finishedSubagentActivityKeys.has(key)) {
        this.activeSubagentActivityIds.set(key, createId());
        this.finishedSubagentActivityKeys.delete(key);
      }
    }
    const id = this.activeSubagentActivityIds.get(key) ?? createId();
    this.agentActivity = appendAgentActivity(this.agentActivity, update, id);
    if (update.event === "completed" || update.event === "error") {
      this.finishedSubagentActivityKeys.add(key);
    }
    this.onActivity?.(this.agentActivity);
  }
}

// Re-exported for renderer/tests that need a typed Spec builder.
export function buildSpec(components: readonly ComponentInstance[], rootId?: string): Spec {
  return componentInstancesToSpec(components, rootId);
}
