"use client";

import dynamic from "next/dynamic";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { ProductCardProps } from "../src/ui/catalog.tsx";
import { labelSubagent } from "../src/ui/subagent-labels.ts";
import type { DisplayAgentActivity, DisplayMessage } from "../src/ui/use-agent-chat.ts";
import { useAgentChat } from "../src/ui/use-agent-chat.ts";
import { useStickyBottomScroll } from "../src/ui/use-sticky-bottom-scroll.ts";

const AGENT_DEBUG = process.env.NEXT_PUBLIC_AGENT_DEBUG === "true";

const JsonRenderPreview = dynamic(
  () => import("../src/ui/catalog.tsx").then((module) => module.JsonRenderPreview),
  {
    loading: () => <div className="preview-empty">Preparing interaction preview…</div>,
    ssr: false,
  },
);

const PROMPT_STARTERS = [
  "Design a modular desk lamp with swappable light modules.",
  "Sketch a habit-tracking app focused on streak recovery.",
  "Prototype a compact smart-garden sensor for windowsills.",
] as const;

const SHORTCUT_KEY =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
    ? "\u2318"
    : "Ctrl";

function JumpToLatestButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="jump-to-latest" onClick={onClick} type="button">
      <svg
        aria-hidden="true"
        fill="none"
        height="16"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.5"
        viewBox="0 0 24 24"
        width="16"
      >
        <path d="M12 4v16" />
        <path d="m6 14 6 6 6-6" />
      </svg>
      Latest
    </button>
  );
}

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
      {showDebugJump ? <JumpToLatestButton onClick={() => jumpDebugToLatest?.()} /> : null}
    </section>
  );
}

function ProductRequestPopover({
  loading,
  product,
  rect,
  onClose,
  onSubmit,
}: {
  loading: boolean;
  product: ProductCardProps;
  rect: DOMRect;
  onClose: () => void;
  onSubmit: (product: ProductCardProps, userText: string) => void;
}) {
  const [value, setValue] = useState("");
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number }>(() => ({
    left: Math.min(Math.max(rect.left, 8), window.innerWidth - 328),
    top: rect.bottom + 8,
  }));

  useLayoutEffect(() => {
    const node = popoverRef.current;
    if (!node) {
      return;
    }
    const popoverRect = node.getBoundingClientRect();
    const gap = 8;
    let top = rect.bottom + gap;
    if (top + popoverRect.height > window.innerHeight - gap) {
      const above = rect.top - popoverRect.height - gap;
      if (above >= gap) {
        top = above;
      } else {
        top = Math.max(gap, window.innerHeight - popoverRect.height - gap);
      }
    }
    const left = Math.min(Math.max(rect.left, gap), window.innerWidth - popoverRect.width - gap);
    setPosition({ top, left });
  }, [rect]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  return (
    <>
      <button
        aria-label="Close request changes"
        className="product-request-backdrop"
        onClick={onClose}
        tabIndex={-1}
        type="button"
      />
      <div
        aria-label={`Request changes to ${product.title}`}
        className="product-request-popover"
        ref={popoverRef}
        role="dialog"
        style={{ left: position.left, top: position.top }}
      >
        <form
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            onSubmit(product, value);
            setValue("");
          }}
        >
          <p className="product-request-heading">
            Request changes to <strong>{product.title}</strong>
          </p>
          <textarea
            aria-label="Requested changes"
            disabled={loading}
            name="product-request"
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
                return;
              }
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="Describe the changes you want"
            ref={textareaRef}
            rows={3}
            value={value}
          />
          <div className="product-request-actions">
            <button onClick={onClose} type="button">
              Cancel
            </button>
            <button disabled={loading || !value.trim()} type="submit">
              Send
            </button>
          </div>
          <p className="product-request-hint">
            <kbd>{SHORTCUT_KEY}</kbd>+<kbd>Enter</kbd> to send · <kbd>Esc</kbd> to close
          </p>
        </form>
      </div>
    </>
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
    stop,
    setInput,
    submitAnswer,
    submitMessage,
    submitText,
  } = useAgentChat();
  const [requestTarget, setRequestTarget] = useState<{
    product: ProductCardProps;
    rect: DOMRect;
  } | null>(null);
  const sourceCardRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!requestTarget) {
      return;
    }
    return () => {
      sourceCardRef.current?.focus();
      sourceCardRef.current = null;
    };
  }, [requestTarget]);

  useEffect(() => {
    if (!requestTarget) {
      return;
    }
    const close = () => setRequestTarget(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [requestTarget]);

  const handleProductClick = useCallback(
    (product: ProductCardProps, rect: DOMRect, source: HTMLElement) => {
      sourceCardRef.current = source;
      setRequestTarget({ product, rect });
    },
    [],
  );

  const closeRequestPopover = useCallback(() => setRequestTarget(null), []);

  const submitProductRequest = useCallback(
    (product: ProductCardProps, userText: string) => {
      const trimmed = userText.trim();
      if (!trimmed) {
        return;
      }
      const message = `Requesting changes to "${product.title}":\n${product.description}\n\n${trimmed}`;
      void submitText(message);
      setRequestTarget(null);
    },
    [submitText],
  );

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
          <p>Product Studio</p>
          <h1>Design a product with the agent</h1>
          {visibleMessages.length === 0 ? (
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
          ) : null}
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

          {showChatJump ? <JumpToLatestButton onClick={() => jumpChatToLatest?.()} /> : null}
        </div>

        <form className="composer" onSubmit={submitMessage}>
          <textarea
            aria-label="Message"
            name="message"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="Describe the product you want to create"
            rows={1}
            value={input}
          />
          <div className="composer-actions">
            {loading ? <span aria-hidden="true" className="composer-spinner" /> : null}
            <span aria-live="polite" className="sr-only">
              {loading ? "Processing" : "Ready"}
            </span>
            {loading ? (
              <button onClick={() => void stop()} type="button">
                Stop
              </button>
            ) : (
              <button disabled={!canSubmit} type="submit">
                Send
              </button>
            )}
          </div>
          <p className="composer-hint">
            <kbd>{SHORTCUT_KEY}</kbd>+<kbd>Enter</kbd> to send
          </p>
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
              <JsonRenderPreview
                key={id}
                loading={loading}
                onProductClick={handleProductClick}
                spec={spec}
              />
            ))
          ) : (
            <div className="preview-empty">Product details appear here.</div>
          )}
        </div>
      </section>

      {AGENT_DEBUG ? <AgentActivityPanel activity={agentActivity} /> : null}

      {requestTarget
        ? createPortal(
            <ProductRequestPopover
              loading={loading}
              product={requestTarget.product}
              rect={requestTarget.rect}
              onClose={closeRequestPopover}
              onSubmit={submitProductRequest}
            />,
            document.body,
          )
        : null}
    </main>
  );
}
