import type { Meta, StoryObj } from "@storybook/react";
import { useEffect } from "react";
import { userEvent, waitFor, within } from "storybook/test";

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

const longLabelLines = [
  JSON.stringify({
    type: "message",
    text: "Choose a workspace template to start from.",
  }),
  JSON.stringify({
    type: "question",
    question: {
      id: "template",
      prompt: "Which template?",
      kind: "multiple_choice",
      options: [
        {
          label: "TEAM_TASK_MANAGEMENT",
          recommended: true,
          description: "Boards, lists, cards and swimlanes for cross-functional squads.",
        },
        {
          label: "CONTENT_CALENDAR_PLANNING",
          description: "Editorial calendar with scheduling, drafts and approval stages.",
        },
        { label: "CUSTOMER_ONBOARDING_WORKFLOW" },
      ],
    },
  }),
];

export const LongOptionLabels: Story = {
  render: () => <AgentWorkspace />,
  decorators: [withAgentStream(longLabelLines)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const composer = canvas.getByLabelText("Message");
    await userEvent.type(composer, "Pick a template");
    await userEvent.click(canvas.getByRole("button", { name: "Send" }));
  },
  parameters: {
    docs: {
      description: {
        story:
          "Regression case for overflowing option labels. UPPER_SNAKE_CASE labels (e.g. `TEAM_TASK_MANAGEMENT`) should wrap inside their card boundaries. Descriptions still clamp to two lines.",
      },
    },
  },
};

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

/* ---------------------------------------------------------------------------
   Three-pane scroll stress (red/green regression case for `.preview-surface`)
   ------------------------------------------------------------------------- */

const LOREM =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor " +
  "incididunt ut labore et dolore magna aliqua;Ut enim ad minim veniam, quis nostrud " +
  "exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.";

/**
 * Build a deterministic NDJSON stream that fills every desktop pane past its
 * own scroll boundary:
 *   - 20 long streamed `message` deltas → one tall assistant bubble (the chat
 *     model reuses a single streaming assistant id per run, so all `message`
 *     lines concatenate into one turn).
 *   - one `ProductGrid` carrying 12 long `ProductCard` children.
 *   - 40 main/subagent activity events (1 main `started` + 1 main `delta`,
 *     plus 19 subagents × started+completed) → 20 debug rows.
 */
function buildThreePaneStressLines(): string[] {
  const lines: string[] = [];

  lines.push(JSON.stringify({ type: "message", text: "Here is the stress fixture." }));

  for (let index = 1; index <= 20; index += 1) {
    lines.push(
      JSON.stringify({
        type: "message",
        text: `Message ${index} of 20. ${LOREM} ${LOREM}`,
      }),
    );
  }

  const cardIds = Array.from({ length: 12 }, (_, index) => `stress-card-${index + 1}`);
  lines.push(
    JSON.stringify({
      type: "ui",
      rootId: "stress-grid",
      components: [
        {
          id: "stress-grid",
          component: "ProductGrid",
          heading: "Stress grid — 12 long cards",
          children: cardIds,
        },
        ...cardIds.map((id, index) => ({
          id,
          component: "ProductCard",
          title: `Concept ${index + 1} — ${LOREM}`,
          description: `${LOREM} ${LOREM}`,
          imagePrompt: `Concept ${index + 1} reference composition`,
        })),
      ],
    }),
  );

  lines.push(JSON.stringify({ type: "main_agent_activity", event: "started" }));
  lines.push(
    JSON.stringify({
      type: "main_agent_activity",
      event: "delta",
      text: `Delegating across 19 subagents for the stress fixture. ${LOREM}`,
    }),
  );

  for (let index = 1; index <= 19; index += 1) {
    lines.push(
      JSON.stringify({
        type: "subagent_activity",
        subagentName: `specialist-${index}`,
        subagentRunId: `stress-run-${index}`,
        event: "started",
        task: `Specialist ${index}: ${LOREM}`,
      }),
    );
    lines.push(
      JSON.stringify({
        type: "subagent_activity",
        subagentName: `specialist-${index}`,
        subagentRunId: `stress-run-${index}`,
        event: "completed",
        message: `Specialist ${index} finished. ${LOREM}`,
      }),
    );
  }

  return lines;
}

const threePaneStressLines = buildThreePaneStressLines();

/**
 * Best-effort: stretch the Storybook preview iframe to a desktop width so the
 * wide (`>1180px`) three-column layout engages. No viewport addon is
 * installed, so we drive the iframe element directly. Falls back silently when
 * the iframe is unreachable — the play then gates strict checks on the layout
 * that actually engaged.
 */
async function engageDesktopLayout(): Promise<boolean> {
  const frame = window.frameElement as HTMLIFrameElement | null;
  if (frame) {
    frame.style.setProperty("width", "1366px");
    frame.style.setProperty("height", "768px");
    frame.style.setProperty("max-width", "none");
  }
  await new Promise((resolve) => setTimeout(resolve, 60));
  return Boolean(frame);
}

function countGridColumns(shell: Element | null): number {
  if (!shell) return 0;
  const value = getComputedStyle(shell).gridTemplateColumns.trim();
  return value ? value.split(/\s+/).filter(Boolean).length : 0;
}

function regionOverflowY(canvasElement: HTMLElement, selector: string): string {
  const node = canvasElement.querySelector(selector);
  if (!node) {
    throw new Error(`Expected scroll region ${selector} to exist in the DOM.`);
  }
  return getComputedStyle(node).overflowY;
}

function expectIndependentOverflow(
  canvasElement: HTMLElement,
  selector: string,
  label: string,
): void {
  const node = canvasElement.querySelector(selector);
  if (!node) {
    throw new Error(`Expected ${label} (${selector}) to exist in the DOM.`);
  }
  if (node.scrollHeight <= node.clientHeight) {
    throw new Error(
      `Expected ${label} to scroll independently (scrollHeight=${node.scrollHeight} ` +
        `<= clientHeight=${node.clientHeight}).`,
    );
  }
}

async function exerciseJumpToLatest(
  canvasElement: HTMLElement,
  paneSelector: string,
  listSelector: string,
  label: string,
): Promise<void> {
  const pane = canvasElement.querySelector(paneSelector);
  const list = canvasElement.querySelector(listSelector);
  if (!pane || !list) {
    throw new Error(`Expected ${label} pane/list to exist for Latest control test.`);
  }

  (list as HTMLElement).scrollTop = 0;
  await waitFor(() => {
    if (pane.querySelector(".jump-to-latest")) return;
    throw new Error(`${label} ↓ Latest button did not appear after scrolling up.`);
  });

  const button = pane.querySelector<HTMLButtonElement>(".jump-to-latest");
  if (!button) {
    throw new Error(`${label} ↓ Latest button disappeared before click.`);
  }
  button.click();

  await waitFor(() => {
    const nearBottom =
      (list as HTMLElement).scrollHeight -
      (list as HTMLElement).scrollTop -
      (list as HTMLElement).clientHeight;
    if (nearBottom > 50) {
      throw new Error(`${label} did not jump back to the bottom (gap=${nearBottom}).`);
    }
  });
}

export const ThreePaneScrollStress: Story = {
  render: () => <AgentWorkspace />,
  decorators: [withAgentStream(threePaneStressLines)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const composer = canvas.getByLabelText("Message");
    await userEvent.type(composer, "Show me the stress fixture");
    await userEvent.click(canvas.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      if (canvasElement.querySelectorAll(".product-card").length < 12) {
        throw new Error("Waiting for the 12 stress product cards to mount.");
      }
    });
    await waitFor(() => {
      if (canvasElement.querySelectorAll(".message").length < 1) {
        throw new Error("Waiting for the streamed chat turn to mount.");
      }
    });
    await waitFor(() => {
      if (canvasElement.querySelectorAll(".agent-activity-item").length < 15) {
        throw new Error("Waiting for the debug activity feed to mount.");
      }
    });

    await engageDesktopLayout();

    // Always-on regression guard: the layout fix makes each pane a scroll
    // region regardless of which responsive mode engaged. `.preview-surface`
    // historically had `overflow: visible`, so it is the focus of this check.
    for (const [selector, label] of [
      [".message-list", "chat"],
      [".preview-surface", "preview"],
      [".agent-activity-list", "debug"],
    ] as const) {
      const overflowY = regionOverflowY(canvasElement, selector);
      if (overflowY !== "auto" && overflowY !== "scroll") {
        throw new Error(`${label} pane overflow-y is "${overflowY}", expected auto/scroll.`);
      }
    }

    const columnCount = countGridColumns(canvasElement.querySelector(".app-shell"));
    const isDesktop = columnCount >= 3;

    if (isDesktop) {
      // Three independent scroll regions, no document/page overflow.
      expectIndependentOverflow(canvasElement, ".message-list", "chat");
      expectIndependentOverflow(canvasElement, ".preview-surface", "preview");
      expectIndependentOverflow(canvasElement, ".agent-activity-list", "debug");

      const docEl = document.documentElement;
      if (docEl.scrollHeight > docEl.clientHeight + 1) {
        throw new Error(
          `Document overflowed at desktop width: scrollHeight=${docEl.scrollHeight} ` +
            `> clientHeight=${docEl.clientHeight}.`,
        );
      }

      // The ↓ Latest jump controls still work for the chat + debug panes.
      await exerciseJumpToLatest(
        canvasElement,
        'section[aria-label="Chat"]',
        ".message-list",
        "chat",
      );
      await exerciseJumpToLatest(
        canvasElement,
        'section[aria-label="Agent debug log"]',
        ".agent-activity-list",
        "debug",
      );
    }
  },
  parameters: {
    docs: {
      description: {
        story: [
          "Deterministic scroll-regression fixture. Mocks `/api/agent` with 20 long streamed chat deltas, one `ProductGrid` of 12 long `ProductCard`s, and 40 main/subagent activity events so every desktop pane overflows past its own boundary.",
          "",
          "**Expected desktop result (`>1180px`):** three independent scroll regions — `.message-list`, `.preview-surface`, `.agent-activity-list` — and no document/page scroll. Historically `.preview-surface` lacked `overflow:auto`/`min-height:0`, so the 12-card grid pushed the whole page into scroll; this story is the red/green case for that fix.",
          "",
          "**Responsive expectations:**",
          "- Desktop (`>1180px`): three pane scrolls, no page scroll.",
          "- Tablet (`860–1180px`): chat + preview scroll in their columns; the debug pane stacks full-width below and scrolls in place.",
          "- Mobile (`<860px`): single column, stacked; normal page scroll.",
          "",
          "**Play assertions:** each pane's computed `overflow-y` is `auto`/`scroll` (the CSS fix). When the wide three-column layout engages, the play additionally asserts each region overflows independently, the document does not overflow, and the chat/debug `↓ Latest` controls still jump back to the bottom.",
        ].join("\n"),
      },
    },
  },
};
