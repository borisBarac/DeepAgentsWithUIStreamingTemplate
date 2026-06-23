"use client";

import { JsonRenderPreview } from "../src/ui/catalog.tsx";
import { useAgentChat } from "../src/ui/use-agent-chat.ts";

export default function Home() {
  const { visibleMessages, input, latestSpec, error, loading, canSubmit, setInput, submitMessage } =
    useAgentChat();

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
              <h2>Ask for an interface</h2>
              <p>Try: Create a login form.</p>
            </div>
          ) : (
            visibleMessages.map((message) => (
              <article className={`message message-${message.role}`} key={message.id}>
                <span>{message.role}</span>
                <p>{message.content}</p>
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
            onChange={(event) => setInput(event.target.value)}
            placeholder="Describe the UI to generate"
            value={input}
          />
          <button disabled={!canSubmit} type="submit">
            {loading ? "Running" : "Send"}
          </button>
        </form>
      </section>

      <section className="preview-pane" aria-label="Generated UI preview">
        <div className="preview-header">
          <p>Rendered JSON</p>
          <span>{loading ? "Streaming" : "Idle"}</span>
        </div>
        <div className="preview-surface">
          {latestSpec ? (
            <JsonRenderPreview loading={loading} spec={latestSpec} />
          ) : (
            <div className="preview-empty">Generated UI appears here.</div>
          )}
        </div>
      </section>
    </main>
  );
}
