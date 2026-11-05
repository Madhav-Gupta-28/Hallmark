/**
 * Has this section been scrolled near enough to matter yet?
 *
 * Every figure on the landing page is a live view call against
 * `hallmarkfi.near` — that is the whole claim, and it is not negotiable. But
 * the sections that make those calls sit below the fold, and firing them at
 * load put ten requests into a concurrency-limited queue before the reader had
 * scrolled past the first paragraph. The last one settled 2.6 s in.
 *
 * So the calls are not removed, only postponed to the moment they are about to
 * be read. `rootMargin` starts them a screen early, which is far longer than a
 * view call takes, so in practice the numbers are already there when the
 * section arrives.
 *
 * Latches on: a section that has been read once does not un-fetch when it
 * scrolls away, and `enabled` must never flap back to false under TanStack.
 */
import { useEffect, useRef, useState } from "react";

export function useInView<T extends HTMLElement>(rootMargin = "100% 0px") {
  const ref = useRef<T>(null);
  // No IntersectionObserver (and SSR, and jsdom) means fetch immediately: the
  // page must never be *less* complete because a browser is older.
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === "undefined");

  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen, rootMargin]);

  return [ref, seen] as const;
}
