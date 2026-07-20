"use client";

import dynamic from "next/dynamic";
import { type ReactNode, useMemo, useState } from "react";
import { labelSubagent } from "../src/ui/subagent-labels.ts";
import type { DisplayAgentActivity, DisplayMessage } from "../src/ui/use-agent-chat.ts";
import { useAgentChat } from "../src/ui/use-agent-chat.ts";
import { useStickyBottomScroll } from "../src/ui/use-sticky-bottom-scroll.ts";

const JsonRenderPreview = dynamic(
  () => import("../src/ui/catalog.tsx").then((module) => module.JsonRenderPreview),
  {
    loading: () => <div className="preview-empty">Preparing interaction preview…</div>,
    ssr: false,
  },
);

const PROMPT_STARTERS = [
  "Map the key agent workflows for a customer onboarding assistant.",
  "Prototype a lightweight planning tool for design teams.",
  "Create a qualification flow for an AI research concierge.",
] as const;

function QuestionControls({
  disabled,
  message,
  onAnswer,
}: {
  disabled: boolean;
  message: DisplayMessage;
  onAnswer: (questionId: string, answer: string) => void;
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
          const normalized = typeof option === "string" ? { label: option } : option;
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
        onAnswer(question.id, answer);
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
        Set answer
      </button>
    </form>
  );
}

function renderActivityBody(activity: DisplayAgentActivity): ReactNode {
  const text = "text" in activity ? activity.text : undefined;
  const message = "message" in activity ? activity.message : undefined;
  const body = text?.trim() ? text : message;
  return body ? <p>{body}</p> : null;
}

function AgentActivityPanel({ activity }: { activity: DisplayAgentActivity[] }) {
  const recentActivity = useMemo(() => activity.slice(-30), [activity]);
  const {
    containerRef: activityListRef,
    bottomAnchorRef: activityAnchorRef,
    showJumpToLatest: showDebugJump,
    jumpToLatest: jumpDebugToLatest,
  } = useStickyBottomScroll([recentActivity], { sticky: true, showJumpToLatest: true });

  return (
    <section className="debug-pane" aria-label="Agent debug log">
      <header className="debug-header">
        <div>
          <p>Debug Log</p>
          <h2>Agent Activity</h2>
        </div>
        <span>{activity.length}</span>
      </header>
      <div className="agent-activity-list" ref={activityListRef}>
        {recentActivity.length === 0 ? (
          <div className="agent-empty">No agent activity yet.</div>
        ) : (
          recentActivity.map((item) => (
            <article className={`agent-activity-item ${item.type} ${item.event}`} key={item.id}>
              {item.type === "main_agent_activity" ? (
                <header>
                  <strong>Main agent</strong>
                  <span>{item.event}</span>
                </header>
              ) : (
                <header>
                  <strong>{labelSubagent(item.subagentName)}</strong>
                  <span>{item.event}</span>
                </header>
              )}
              {"task" in item && item.task ? <p>{item.task}</p> : null}
              {renderActivityBody(item)}
            </article>
          ))
        )}
        <div aria-hidden="true" ref={activityAnchorRef} />
      </div>
      {showDebugJump ? (
        <button className="jump-to-latest" onClick={jumpDebugToLatest} type="button">
          ↓ Latest
        </button>
      ) : null}
    </section>
  );
}

export function AgentWorkspace() {
  const {
    visibleMessages,
    agentActivity,
    input,
    uiSpecs,
    error,
    loading,
    canSubmit,
    setInput,
    submitAnswer,
    submitMessage,
  } = useAgentChat();
  const {
    bottomAnchorRef,
    containerRef: messageListRef,
    showJumpToLatest: showChatJump,
    jumpToLatest: jumpChatToLatest,
  } = useStickyBottomScroll([visibleMessages, agentActivity, uiSpecs, error], {
    sticky: true,
    showJumpToLatest: true,
  });

  return (
    <main className="app-shell">
      <section className="chat-pane" aria-label="Chat">
        <header className="app-header">
          <p>Deep Agent Template</p>
          <h1>Agent interaction workspace</h1>
          <fieldset className="prompt-starters">
            <legend className="sr-only">Prompt starters</legend>
            {PROMPT_STARTERS.map((starter) => (
              <button
                disabled={loading}
                key={starter}
                type="button"
                onClick={() => setInput(starter)}
              >
                {starter}
              </button>
            ))}
          </fieldset>
        </header>

        <div className="message-list-wrap">
          <div className="message-list" ref={messageListRef}>
            {visibleMessages.length === 0 ? (
              <div className="empty-state">
                <h2>Design with the agent</h2>
                <p>
                  Use a starter or describe the product, workflow, and constraints you want
                  explored.
                </p>
              </div>
            ) : (
              visibleMessages.map((message) => (
                <article className={`message message-${message.role}`} key={message.id}>
                  <span>{message.role}</span>
                  <p>{message.content}</p>
                  <QuestionControls disabled={loading} message={message} onAnswer={submitAnswer} />
                  {message.question && message.answer ? <p>Your answer: {message.answer}</p> : null}
                </article>
              ))
            )}
            {error ? (
              <article className="message message-error">
                <span>error</span>
                <p>{error}</p>
              </article>
            ) : null}
            <div aria-hidden="true" className="message-list-anchor" ref={bottomAnchorRef} />
          </div>

          {showChatJump ? (
            <button className="jump-to-latest" onClick={jumpChatToLatest} type="button">
              ↓ Latest
            </button>
          ) : null}
        </div>

        <form className="composer" onSubmit={submitMessage}>
          <textarea
            aria-label="Message"
            name="message"
            onChange={(event) => setInput(event.target.value)}
            placeholder="Describe the product you want to create"
            rows={3}
            value={input}
          />
          <div className="composer-actions">
            {loading ? <span aria-hidden="true" className="composer-spinner" /> : null}
            <span aria-live="polite" className="sr-only">
              {loading ? "Processing" : "Ready"}
            </span>
            <button disabled={!canSubmit} type="submit">
              Send
            </button>
          </div>
        </form>
      </section>

      <section className="preview-pane" aria-label="Generated UI preview">
        <div className="preview-header">
          <h2>Interaction Zone</h2>
          <span>{loading ? "Processing" : "Idle"}</span>
        </div>
        <div className="preview-surface">
          {uiSpecs.length > 0 ? (
            uiSpecs.map(({ id, spec }) => (
              <JsonRenderPreview key={id} loading={loading} spec={spec} />
            ))
          ) : (
            <div className="preview-empty">Product details appear here.</div>
          )}
        </div>
      </section>

      <AgentActivityPanel activity={agentActivity} />
    </main>
  );
}
