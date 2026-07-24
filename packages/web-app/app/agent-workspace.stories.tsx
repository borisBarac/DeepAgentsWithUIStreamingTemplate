import type { Meta, StoryObj } from "@storybook/react";
import { useEffect } from "react";
import { userEvent, within } from "storybook/test";

import { AgentWorkspace } from "./agent-workspace.tsx";

/**
 * Mock `window.fetch` so `/api/agent` returns a fixed NDJSON stream of
 * `UiUpdate` lines. Use as a Storybook decorator.
 */
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

const meta = {
  title: "Web App/AgentWorkspace",
  component: AgentWorkspace,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component: [
          "Top-level workspace rendered by `app/page.tsx`. Composes three panes in a responsive grid:",
          "",
          "1. **Chat pane** — prompt starters, message list, composer.",
          "2. **Preview pane** — dynamic-imported `JsonRenderPreview` for each spec the agent emits.",
          "3. **Debug pane** — main-agent and subagent activity feed.",
          "",
          "**File:** `packages/web-app/app/agent-workspace.tsx`",
          "",
          "**Hooks used:**",
          "- `useAgentChat()` — owns all chat state (messages, activity, ui specs, loading, error).",
          "- `useStickyBottomScroll()` — auto-scroll-to-bottom + `↓ Latest` jump button (chat pane + debug pane).",
          "",
          "**Responsive behavior:**",
          "- Wide (`>1180px`): three columns side-by-side.",
          "- Tablet (`860–1180px`): chat + preview columns, debug pane collapses below.",
          "- Mobile (`<860px`): single column, stacked; composer becomes single-column.",
          "",
          "**Accessibility:**",
          "- Sections have `aria-label`s (Chat / Generated UI preview / Agent debug log).",
          '- The composer\'s `<span class="sr-only" aria-live="polite">` announces `Processing`/`Ready`.',
          "- The prompt-starters `<fieldset>` has a `.sr-only` `<legend>`.",
          "- Status pills in the preview header announce `Processing`/`Idle` (visible text, no aria-live).",
          "",
          "**Notes:** Stories below mock `window.fetch` to return a fixed NDJSON stream. Open the network-mocked stories to interact with the agent end-to-end.",
        ].join("\n"),
      },
    },
  },
  args: {},
} satisfies Meta<typeof AgentWorkspace>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  render: () => <AgentWorkspace />,
  parameters: {
    docs: {
      description: {
        story:
          "Fresh mount. No messages, no specs, no activity. The empty-state hero (`Design with the agent`) is visible, the preview pane shows `Product details appear here.`, and the debug pane shows `No agent activity yet.`.",
      },
    },
  },
};

const introLines = [
  JSON.stringify({
    type: "message",
    text: "I can sketch a planning workspace for design teams. Let me think through the key flows first.",
  }),
  JSON.stringify({
    type: "main_agent_activity",
    event: "started",
  }),
];

export const InitialResponse: Story = {
  render: () => <AgentWorkspace />,
  decorators: [withAgentStream(introLines)],
  parameters: {
    docs: {
      description: {
        story:
          "Mocks `/api/agent` to return a single assistant message plus a main-agent activity `started` event. Type a message and submit to see the stream.",
      },
    },
  },
};

const qualificationLines = [
  JSON.stringify({
    type: "message",
    text: "Great — I have two quick qualification questions before I sketch the workspace.",
  }),
  JSON.stringify({
    type: "question",
    question: {
      id: "primary-user",
      prompt: "Who is the primary user?",
      kind: "multiple_choice",
      options: [
        { label: "Product designer", recommended: true },
        { label: "Engineer" },
        { label: "PM" },
      ],
    },
  }),
  JSON.stringify({
    type: "question",
    question: {
      id: "primary-goal",
      prompt: "What is the primary goal?",
      kind: "open_text",
      placeholder: "e.g. Reduce handoff friction",
    },
  }),
];

export const QualificationQuestions: Story = {
  render: () => <AgentWorkspace />,
  decorators: [withAgentStream(qualificationLines)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const composer = canvas.getByLabelText("Message");
    await userEvent.type(composer, "Help me plan it");
    await userEvent.click(canvas.getByRole("button", { name: "Send" }));
  },
  parameters: {
    docs: {
      description: {
        story:
          "Mocks the stream so the assistant asks one multiple-choice and one open-text question. While questions are open, the `Send` button stays disabled until every question has an answer.",
      },
    },
  },
};

const productGridLines = [
  JSON.stringify({
    type: "message",
    text: "Here are two starter concepts.",
  }),
  JSON.stringify({
    type: "ui",
    rootId: "products",
    components: [
      {
        id: "products",
        component: "ProductGrid",
        heading: "Concepts",
        children: ["card-1", "card-2"],
      },
      {
        id: "card-1",
        component: "ProductCard",
        title: "Launch Map",
        description: "A planning workspace for design teams.",
        imagePrompt: "Kanban board with milestones",
      },
      {
        id: "card-2",
        component: "ProductCard",
        title: "Brief Buddy",
        description: "Turn rough notes into structured creative briefs.",
        imagePrompt: "Notepad with sticky tabs",
      },
    ],
  }),
];

export const ProductGridStream: Story = {
  render: () => <AgentWorkspace />,
  decorators: [withAgentStream(productGridLines)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const composer = canvas.getByLabelText("Message");
    await userEvent.type(composer, "Show me two product ideas");
    await userEvent.click(canvas.getByRole("button", { name: "Send" }));
  },
  parameters: {
    docs: {
      description: {
        story:
          "Mocks the stream to return a `ProductGrid` spec. The preview pane renders the grid; replacing it with another canonical ProductGrid later would *replace* the existing entry rather than appending.",
      },
    },
  },
};

const subagentActivityLines = [
  JSON.stringify({
    type: "main_agent_activity",
    event: "started",
  }),
  JSON.stringify({
    type: "main_agent_activity",
    event: "delta",
    text: "Delegating to specialists.",
  }),
  JSON.stringify({
    type: "subagent_activity",
    subagentName: "clarifier",
    event: "started",
    task: "Qualify scope with the user.",
  }),
  JSON.stringify({
    type: "subagent_activity",
    subagentName: "researcher",
    event: "completed",
    message: "Pulled three reference flows.",
  }),
  JSON.stringify({
    type: "subagent_activity",
    subagentName: "image-designer",
    event: "error",
    message: "Image generation quota exceeded.",
  }),
  JSON.stringify({ type: "message", text: "Done — see the debug pane for activity." }),
];

export const SubagentActivity: Story = {
  render: () => <AgentWorkspace />,
  decorators: [withAgentStream(subagentActivityLines)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const composer = canvas.getByLabelText("Message");
    await userEvent.type(composer, "Delegate to the team");
    await userEvent.click(canvas.getByRole("button", { name: "Send" }));
  },
  parameters: {
    docs: {
      description: {
        story:
          "Mocks a stream that exercises `main_agent_activity` (delta) and three subagent activities including an error. Labels are humanized via `labelSubagent` (e.g. `researcher` → `Researcher`).",
      },
    },
  },
};

const errorLines = [
  JSON.stringify({
    type: "error",
    message: "The agent stream rejected an out-of-catalog component.",
  }),
];

export const ErrorState: Story = {
  render: () => <AgentWorkspace />,
  decorators: [withAgentStream(errorLines)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const composer = canvas.getByLabelText("Message");
    await userEvent.type(composer, "Force an error");
    await userEvent.click(canvas.getByRole("button", { name: "Send" }));
  },
  parameters: {
    docs: {
      description: {
        story:
          "The agent can emit `{type:'error', message}` updates; the chat pane renders them as a `.message-error` card with a red border.",
      },
    },
  },
};

function withNetworkFailure() {
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
  render: () => <AgentWorkspace />,
  decorators: [withNetworkFailure()],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const composer = canvas.getByLabelText("Message");
    await userEvent.type(composer, "Break the network");
    await userEvent.click(canvas.getByRole("button", { name: "Send" }));
  },
  parameters: {
    docs: {
      description: {
        story:
          "If `fetch` resolves with a non-OK status (or the body is null), `useAgentChat` throws `Request failed with status <code>.` and surfaces the message in the same `.message-error` slot.",
      },
    },
  },
};
