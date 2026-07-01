"use client";

import { type DependencyList, useLayoutEffect, useRef } from "react";

type ScrollMetrics = {
  clientHeight: number;
  scrollHeight: number;
};

type ScrollableElement = ScrollMetrics & {
  scrollTop: number;
};

export function getBottomScrollTop({ clientHeight, scrollHeight }: ScrollMetrics): number {
  return Math.max(0, scrollHeight - clientHeight);
}

export function scrollElementToBottom(element: ScrollableElement): void {
  element.scrollTop = getBottomScrollTop(element);
}

export function useStickyBottomScroll(dependencies: DependencyList) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const bottomAnchorRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    bottomAnchorRef.current?.scrollIntoView({ block: "end" });
    scrollElementToBottom(container);
  }, [...dependencies]);

  return { bottomAnchorRef, containerRef };
}
