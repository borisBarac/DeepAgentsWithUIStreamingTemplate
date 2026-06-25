"use client";

import { normalizeQuestionOption } from "@deep-agent-template/core";
import { useState } from "react";
import { JsonRenderPreview } from "../src/ui/catalog.tsx";
import type { DisplayMessage } from "../src/ui/use-agent-chat.ts";
import { useAgentChat } from "../src/ui/use-agent-chat.ts";

function QuestionControls({
  disabled,
  message,
  onAnswer,
}: {
  disabled: boolean;
  message: DisplayMessage;
  onAnswer: (questionId: string, answer: string) => Promise<void>;
}) {
  const [answer, setAnswer] = useState("");
  const question = message.question;
  if (!question) {
    return null;
  }

  if (question.kind === "multiple_choice") {
    return (
      <div className="question-options">
        {question.options.map((option) => {
          const normalized = normalizeQuestionOption(option);
          return (
            <button
              disabled={disabled || message.answered}
              key={normalized.label}
              type="button"
              onClick={() => onAnswer(question.id, normalized.label)}
            >
              <span>{normalized.label}</span>
              {normalized.recommended ? <em> (recommended)</em> : null}
              {normalized.description ? <small> — {normalized.description}</small> : null}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <form
      className="question-form"
      onSubmit={(event) => {
        event.preventDefault();
        void onAnswer(question.id, answer);
        setAnswer("");
      }}
    >
      <input
        aria-label={question.prompt}
        disabled={disabled || message.answered}
        name={`question-${question.id}`}
        onChange={(event) => setAnswer(event.target.value)}
        placeholder={question.placeholder ?? "Type your answer"}
        value={answer}
      />
      <button disabled={disabled || message.answered || !answer.trim()} type="submit">
        Reply
      </button>
    </form>
  );
}

export default function Home() {
  const {
    visibleMessages,
    input,
    latestSpec,
    error,
    loading,
    canSubmit,
    setInput,
    submitAnswer,
    submitMessage,
  } = useAgentChat();

  return (
    <main className="app-shell">
      <section className="chat-pane" aria-label="Chat">
        <header className="app-header">
          <p>Deep Agent Template</p>
          <h1>Generative UI</h1>
        </header>

        <div className="message-list">
          {visibleMessages.length === 0 ? (
            <div className="empty-state">
              <h2>Describe a product idea</h2>
              <p>Try: I want to launch a lightweight planning tool for design teams.</p>
            </div>
          ) : (
            visibleMessages.map((message) => (
              <article className={`message message-${message.role}`} key={message.id}>
                <span>{message.role}</span>
                <p>{message.content}</p>
                <QuestionControls disabled={loading} message={message} onAnswer={submitAnswer} />
              </article>
            ))
          )}
          {error ? (
            <article className="message message-error">
              <span>error</span>
              <p>{error}</p>
            </article>
          ) : null}
        </div>

        <form className="composer" onSubmit={submitMessage}>
          <input
            aria-label="Message"
            name="message"
            onChange={(event) => setInput(event.target.value)}
            placeholder="Describe the product you want to create"
            value={input}
          />
          <button disabled={!canSubmit} type="submit">
            {loading ? "Running" : "Send"}
          </button>
        </form>
      </section>

      <section className="preview-pane" aria-label="Generated UI preview">
        <div className="preview-header">
          <p>Interaction Zone</p>
          <span>{loading ? "Streaming" : "Idle"}</span>
        </div>
        <div className="preview-surface">
          {latestSpec ? (
            <JsonRenderPreview loading={loading} spec={latestSpec} />
          ) : (
            <div className="preview-empty">Product details appear here.</div>
          )}
        </div>
      </section>
    </main>
  );
}
