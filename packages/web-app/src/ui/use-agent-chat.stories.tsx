import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useState } from "react";
import { userEvent, within } from "storybook/test";

import type { DisplayMessage } from "./session-model.ts";
import { useAgentChat } from "./use-agent-chat.ts";

function withAgentStream(lines: string[]) {
  return function Decorator(Story: () => React.ReactNode) {
    useEffect(() => {
      const original = window.fetch;
      window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (typeof input === "string" && input.endsWith("/api/agent")) {
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              const encoder = new TextEncoder();
              for (const line of lines) {
                controller.enqueue(encoder.encode(`${line}\n`));
              }
              controller.close();
            },
          });
          return new Response(stream, {
            status: 200,
            headers: { "Content-Type": "application/x-ndjson" },
          });
        }
        return original(input, init);
      }) as typeof window.fetch;
      return () => {
        window.fetch = original;
      };
    }, []);
    return <Story />;
  };
}

/**
 * Demo surface for {@link useAgentChat}. Renders the live state object so the
 * Controls / Interactions panels can drive a real submission end-to-end.
 */
function ChatInspector() {
  const chat = useAgentChat();
  const [submitted, setSubmitted] = useState<DisplayMessage[]>([]);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void chat.submitMessage(event);
        }}
        style={{ display: "grid", gap: 8 }}
      >
        <label htmlFor="message-input" style={{ fontSize: 13, fontWeight: 700 }}>
          Message
        </label>
        <textarea
          aria-label="Message"
          id="message-input"
          onChange={(event) => chat.setInput(event.target.value)}
          placeholder="Describe the product you want to create"
          rows={3}
          value={chat.input}
        />
        <div>
          <button disabled={!chat.canSubmit} type="submit">
            Send
          </button>
          {chat.loading ? <span style={{ marginLeft: 12 }}>Loading…</span> : null}
        </div>
      </form>

      <section>
        <h3 style={{ margin: "0 0 8px", fontSize: 13 }}>State</h3>
        <dl
          style={{
            background: "#f0f4f8",
            border: "1px solid #d9e0e6",
            borderRadius: 8,
            display: "grid",
            gap: 6,
            fontSize: 13,
            gridTemplateColumns: "max-content 1fr",
            padding: 12,
          }}
        >
          <dt>
            <code>loading</code>
          </dt>
          <dd style={{ margin: 0 }}>{String(chat.loading)}</dd>
          <dt>
            <code>canSubmit</code>
          </dt>
          <dd style={{ margin: 0 }}>{String(chat.canSubmit)}</dd>
          <dt>
            <code>error</code>
          </dt>
          <dd style={{ margin: 0 }}>{chat.error ?? "—"}</dd>
          <dt>
            <code>messages.length</code>
          </dt>
          <dd style={{ margin: 0 }}>{chat.messages.length}</dd>
          <dt>
            <code>agentActivity.length</code>
          </dt>
          <dd style={{ margin: 0 }}>{chat.agentActivity.length}</dd>
          <dt>
            <code>uiSpecs.length</code>
          </dt>
          <dd style={{ margin: 0 }}>{chat.uiSpecs.length}</dd>
          <dt>
            <code>latestSpec?.root</code>
          </dt>
          <dd style={{ margin: 0 }}>{chat.latestSpec?.root ?? "—"}</dd>
        </dl>
      </section>

      <section>
        <h3 style={{ margin: "0 0 8px", fontSize: 13 }}>Visible messages</h3>
        <ul style={{ display: "grid", gap: 6, listStyle: "none", margin: 0, padding: 0 }}>
          {chat.visibleMessages.map((message) => (
            <li
              key={message.id}
              style={{
                background: "#ffffff",
                border: "1px solid #d9e0e6",
                borderRadius: 8,
                padding: 12,
              }}
            >
              <strong>{message.role}</strong>: {message.content}
              {message.answer ? <em> (answered: {message.answer})</em> : null}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 style={{ margin: "0 0 8px", fontSize: 13 }}>Latest spec (JSON)</h3>
        <pre
          style={{
            background: "#0b484a",
            borderRadius: 8,
            color: "#dff0ea",
            fontSize: 12,
            margin: 0,
            overflow: "auto",
            padding: 12,
          }}
        >
          {chat.latestSpec ? JSON.stringify(chat.latestSpec, null, 2) : "// no spec yet"}
        </pre>
        <button onClick={() => setSubmitted(chat.messages)} style={{ marginTop: 8 }} type="button">
          Snapshot messages
        </button>
        {submitted.length > 0 ? (
          <p style={{ color: "#4f5f6c", fontSize: 12, marginTop: 8 }}>
            Snapshot: {submitted.length} messages
          </p>
        ) : null}
      </section>
    </div>
  );
}

const meta = {
  title: "Web App/useAgentChat",
  component: ChatInspector,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component: [
          "Hook that owns the entire chat session state for the web-app.",
          "",
          "**File:** `packages/web-app/src/ui/use-agent-chat.ts`",
          "",
          "Returns:",
          "- `messages`, `visibleMessages` — raw + answer-decorated messages.",
          "- `agentActivity` — main-agent + subagent activity feed.",
          "- `input`, `setInput` — composer state.",
          "- `uiSpecs`, `latestSpecs`, `latestSpec` — accumulated UI specs.",
          "- `error`, `loading`, `canSubmit` — submission state.",
          "- `submitAnswer(questionId, answer)` — record an answer to an open question.",
          "- `submitMessage(event)` — submit the composer (or batched answers if open questions exist).",
          "",
          "Internally the hook streams `/api/agent` NDJSON line-by-line and routes each line through `applyAgentChatLine`, which validates against the same catalog as the server.",
        ].join("\n"),
      },
    },
  },
  args: {},
} satisfies Meta<typeof ChatInspector>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {
  render: () => <ChatInspector />,
  parameters: {
    docs: {
      description: {
        story:
          "Fresh mount. `canSubmit` is false because the composer is empty; everything else is in its zero state.",
      },
    },
  },
};

const messageLines = [JSON.stringify({ type: "message", text: "Hello from the agent." })];

export const SingleMessage: Story = {
  render: () => <ChatInspector />,
  decorators: [withAgentStream(messageLines)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const composer = canvas.getByLabelText("Message");
    await userEvent.type(composer, "Hi");
    await userEvent.click(canvas.getByRole("button", { name: "Send" }));
  },
  parameters: {
    docs: {
      description: {
        story: "Type and submit — the mocked stream returns a single assistant message.",
      },
    },
  },
};

const questionLines = [
  JSON.stringify({
    type: "question",
    question: {
      id: "goal",
      prompt: "What is your primary goal?",
      kind: "multiple_choice",
      options: ["Reduce handoff friction", "Improve onboarding time"],
    },
  }),
];

export const OpenQuestion: Story = {
  render: () => <ChatInspector />,
  decorators: [withAgentStream(questionLines)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const composer = canvas.getByLabelText("Message");
    await userEvent.type(composer, "Plan it");
    await userEvent.click(canvas.getByRole("button", { name: "Send" }));
  },
  parameters: {
    docs: {
      description: {
        story:
          "A question update is rendered into the visible messages with `message.question` populated. The hook tracks open questions and keeps `canSubmit` true so long as all open questions have answers.",
      },
    },
  },
};

const specLines = [
  JSON.stringify({
    type: "ui",
    rootId: "products",
    components: [
      {
        id: "products",
        component: "ProductGrid",
        heading: "Concepts",
        children: ["card"],
      },
      {
        id: "card",
        component: "ProductCard",
        title: "Launch Map",
        description: "A planning workspace for design teams.",
        imagePrompt: "Kanban board with milestones",
      },
    ],
  }),
];

export const SpecStream: Story = {
  render: () => <ChatInspector />,
  decorators: [withAgentStream(specLines)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const composer = canvas.getByLabelText("Message");
    await userEvent.type(composer, "Show me a product");
    await userEvent.click(canvas.getByRole("button", { name: "Send" }));
  },
  parameters: {
    docs: {
      description: {
        story:
          "After the spec arrives, `latestSpec.root` reads `products` and the JSON view at the bottom updates.",
      },
    },
  },
};

const errorLines = [JSON.stringify({ type: "error", message: "Mock stream error" })];

export const ErrorState: Story = {
  render: () => <ChatInspector />,
  decorators: [withAgentStream(errorLines)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const composer = canvas.getByLabelText("Message");
    await userEvent.type(composer, "Fail");
    await userEvent.click(canvas.getByRole("button", { name: "Send" }));
  },
  parameters: {
    docs: {
      description: {
        story:
          "`{type:'error', message}` updates surface through the same `error` slot as thrown fetch errors.",
      },
    },
  },
};

function withFailingFetch() {
  return function Decorator(Story: () => React.ReactNode) {
    useEffect(() => {
      const original = window.fetch;
      const failing = async () => new Response("Internal Server Error", { status: 500 });
      window.fetch = new Proxy(failing, {
        get(target, prop, receiver) {
          if (prop in target) {
            return Reflect.get(target, prop, receiver);
          }
          return Reflect.get(original, prop, receiver);
        },
      }) as unknown as typeof window.fetch;
      return () => {
        window.fetch = original;
      };
    }, []);
    return <Story />;
  };
}

export const NetworkError: Story = {
  render: () => <ChatInspector />,
  decorators: [withFailingFetch()],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const composer = canvas.getByLabelText("Message");
    await userEvent.type(composer, "Break");
    await userEvent.click(canvas.getByRole("button", { name: "Send" }));
  },
  parameters: {
    docs: {
      description: {
        story:
          "Non-OK responses (or null body) throw inside `submitText`; the message `Request failed with status 500.` lands in `error`.",
      },
    },
  },
};
