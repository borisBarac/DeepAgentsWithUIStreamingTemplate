"use client";

import {
  type DependencyList,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

type ScrollMetrics = {
  clientHeight: number;
  scrollHeight: number;
};

type ScrollableElement = ScrollMetrics & {
  scrollTop: number;
};

type Options = {
  sticky?: boolean;
  threshold?: number;
  showJumpToLatest?: boolean;
};

export function getBottomScrollTop({ clientHeight, scrollHeight }: ScrollMetrics): number {
  return Math.max(0, scrollHeight - clientHeight);
}

export function scrollElementToBottom(element: ScrollableElement): void {
  element.scrollTop = getBottomScrollTop(element);
}

export function useStickyBottomScroll(dependencies: DependencyList, options: Options = {}) {
  const { sticky = false, threshold = 50, showJumpToLatest = false } = options;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const bottomAnchorRef = useRef<HTMLDivElement | null>(null);
  const [showJump, setShowJump] = useState(false);
  const isNearBottomRef = useRef(true);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onScroll = () => {
      const nearBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
      isNearBottomRef.current = nearBottom;
      if (showJumpToLatest) setShowJump(!nearBottom);
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [threshold, showJumpToLatest]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (sticky && !isNearBottomRef.current) return;
    bottomAnchorRef.current?.scrollIntoView({ block: "end" });
    scrollElementToBottom(container);
  }, [...dependencies, sticky]);

  const jumpToLatest = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    isNearBottomRef.current = true;
    bottomAnchorRef.current?.scrollIntoView({ block: "end" });
    scrollElementToBottom(container);
    setShowJump(false);
  }, []);

  return {
    bottomAnchorRef,
    containerRef,
    showJumpToLatest: showJumpToLatest ? showJump : undefined,
    jumpToLatest: showJumpToLatest ? jumpToLatest : undefined,
  };
}
