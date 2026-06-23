"use client";

import type { Spec } from "@json-render/core";
import { useMemo, useRef, useState } from "react";

import { JsonRenderPreview } from "../src/ui/catalog.tsx";
import type { ChatMessage, UiUpdate } from "../src/ui/types.ts";

type DisplayMessage = ChatMessage & {
  id: string;
};

function createSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseUpdateLine(line: string): UiUpdate | null {
  try {
    const update = JSON.parse(line) as UiUpdate;
    if (update.type === "message" || update.type === "ui" || update.type === "error") {
      return update;
    }
  } catch {
    return null;
  }
  return null;
}

export default function Home() {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [assistantText, setAssistantText] = useState("");
  const [input, setInput] = useState("");
  const [latestSpec, setLatestSpec] = useState<Spec | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const sessionIdRef = useRef<string>(createSessionId());
  const canSubmit = input.trim().length > 0 && !loading;

  const visibleMessages = useMemo(
    () =>
      assistantText
        ? [...messages, { role: "assistant" as const, content: assistantText, id: "streaming" }]
        : messages,
    [assistantText, messages],
  );

  async function submitMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = input.trim();
    if (!message || loading) {
      return;
    }

    setMessages((current) => [
      ...current,
      { role: "user", content: message, id: createSessionId() },
    ]);
    setAssistantText("");
    setError(null);
    setInput("");
    setLoading(true);

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
      let streamedText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffered += decoder.decode(value, { stream: true });
        const lines = buffered.split("\n");
        buffered = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) {
            continue;
          }
          const update = parseUpdateLine(line);
          if (!update) {
            continue;
          }
          if (update.type === "message") {
            streamedText += `${streamedText ? "\n" : ""}${update.text}`;
            setAssistantText(streamedText);
          }
          if (update.type === "ui") {
            setLatestSpec(update.spec);
          }
          if (update.type === "error") {
            setError(update.message);
          }
        }
      }

      if (buffered.trim()) {
        const update = parseUpdateLine(buffered);
        if (update?.type === "message") {
          streamedText += `${streamedText ? "\n" : ""}${update.text}`;
          setAssistantText(streamedText);
        }
        if (update?.type === "ui") {
          setLatestSpec(update.spec);
        }
        if (update?.type === "error") {
          setError(update.message);
        }
      }

      if (streamedText) {
        setMessages((current) => [
          ...current,
          { role: "assistant", content: streamedText, id: createSessionId() },
        ]);
        setAssistantText("");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }

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
