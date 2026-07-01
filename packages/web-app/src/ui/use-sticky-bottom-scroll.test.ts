import { describe, expect, it } from "bun:test";

import { getBottomScrollTop, scrollElementToBottom } from "./use-sticky-bottom-scroll.ts";

describe("sticky bottom scroll", () => {
  it("keeps short content at the top scroll position", () => {
    expect(getBottomScrollTop({ clientHeight: 500, scrollHeight: 320 })).toBe(0);
  });

  it("returns the bottom scroll position for overflowing content", () => {
    expect(getBottomScrollTop({ clientHeight: 240, scrollHeight: 900 })).toBe(660);
  });

  it("mutates a scrollable element to the bottom", () => {
    const element = { clientHeight: 300, scrollHeight: 840, scrollTop: 12 };

    scrollElementToBottom(element);

    expect(element.scrollTop).toBe(540);
  });
});
