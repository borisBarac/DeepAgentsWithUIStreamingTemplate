import type { Meta, StoryObj } from "@storybook/react";
import { useStickyBottomScroll } from "./use-sticky-bottom-scroll.ts";

function StickyList({
  itemCount,
  showJump,
  sticky,
  threshold,
}: {
  itemCount: number;
  showJump: boolean;
  sticky: boolean;
  threshold: number;
}) {
  const { containerRef, bottomAnchorRef, showJumpToLatest, jumpToLatest } = useStickyBottomScroll(
    [itemCount],
    { sticky, threshold, showJumpToLatest: showJump },
  );
  return (
    <div style={{ display: "grid", gap: 8, height: 320 }}>
      <div style={{ color: "#4f5f6c", fontSize: 13 }}>
        `sticky: ${String(sticky)}` · `showJumpToLatest: ${String(showJump)}` · `threshold: $
        {threshold}px`
      </div>
      <div
        ref={containerRef}
        style={{
          border: "1px solid #d9e0e6",
          borderRadius: 8,
          overflow: "auto",
          padding: 12,
        }}
      >
        {Array.from({ length: itemCount }, (_, index) => `demo-${index}`).map((key) => (
          <article className="message" key={key}>
            <span>Item {Number(key.slice(5)) + 1}</span>
            <p>Auto-scrolls to bottom when `sticky` and the user is near the bottom.</p>
          </article>
        ))}
        <div aria-hidden="true" ref={bottomAnchorRef} />
      </div>
      {showJump && showJumpToLatest ? (
        <button onClick={() => jumpToLatest?.()} style={{ justifySelf: "center" }} type="button">
          ↓ Latest
        </button>
      ) : null}
    </div>
  );
}

const meta = {
  title: "Web App/useStickyBottomScroll",
  component: StickyList,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component: [
          "Auto-scroll-to-bottom hook used by both the chat message list and the debug activity pane.",
          "",
          "**File:** `packages/web-app/src/ui/use-sticky-bottom-scroll.ts`",
          "",
          "Behavior:",
          "- When `sticky: true` and the user is within `threshold` pixels of the bottom, new content auto-scrolls into view.",
          "- When `showJumpToLatest: true`, the hook also tracks whether the user has scrolled away from the bottom and exposes a `showJumpToLatest` boolean + `jumpToLatest()` callback.",
          "- `jumpToLatest()` resets `isNearBottomRef` and scrolls to the bottom anchor.",
          "- `getBottomScrollTop` / `scrollElementToBottom` are pure helpers exported for testing.",
          "",
          "Returns `{ containerRef, bottomAnchorRef, showJumpToLatest?, jumpToLatest? }`.",
        ].join("\n"),
      },
    },
  },
  argTypes: {
    itemCount: {
      control: { type: "number", min: 0, max: 60, step: 1 },
      description:
        "Demo-only prop. Each change is in the hook's dependency list so the effect re-runs.",
      table: { category: "Demo props" },
    },
    showJump: {
      control: "boolean",
      description: "Maps to the hook's `showJumpToLatest` option.",
      table: { category: "Demo props" },
    },
    sticky: {
      control: "boolean",
      description: "Maps to the hook's `sticky` option.",
      table: { category: "Demo props" },
    },
    threshold: {
      control: { type: "number", min: 0, max: 240, step: 10 },
      description: "Pixels-from-bottom tolerance used to decide `isNearBottom`.",
      table: { category: "Demo props" },
    },
  },
  args: { itemCount: 12, showJump: true, sticky: true, threshold: 50 },
} satisfies Meta<typeof StickyList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { itemCount: 12, showJump: true, sticky: true, threshold: 50 },
  parameters: {
    docs: {
      description: {
        story:
          "Same options the chat pane uses. Scroll up — the `↓ Latest` button appears; click it (or add an item via the Controls panel) to jump back.",
      },
    },
  },
};

export const WithoutJumpButton: Story = {
  args: { itemCount: 6, showJump: false, sticky: true, threshold: 50 },
  parameters: {
    docs: {
      description: {
        story:
          "`showJumpToLatest: false` omits the jump button. The hook still auto-scrolls when sticky.",
      },
    },
  },
};

export const NotSticky: Story = {
  args: { itemCount: 12, showJump: true, sticky: false, threshold: 50 },
  parameters: {
    docs: {
      description: {
        story:
          "When `sticky: false`, new content does NOT push the scroll position. Only the jump button (if enabled) appears when the user scrolls away.",
      },
    },
  },
};

export const Empty: Story = {
  args: { itemCount: 0, showJump: true, sticky: true, threshold: 50 },
  parameters: {
    docs: {
      description: {
        story:
          "Zero items — the container is still scrollable infrastructure but has no content. Both production callers fall back to their own empty states (chat: `Design with the agent`; debug: `No agent activity yet.`).",
      },
    },
  },
};
