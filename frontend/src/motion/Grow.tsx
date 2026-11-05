/**
 * A bar that draws itself to `pct` the first time it is seen.
 *
 * The same contract as `Count`: the caller owns the number, this only animates
 * the path to it, and under `prefers-reduced-motion` there is no path — the bar
 * is simply the width it should be, immediately.
 */
import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "./reveal";

export function Grow({ pct, ms = 1100, className = "", minPx = 0 }: {
  pct: number; ms?: number; className?: string;
  /** Floor in pixels. A share too small to occupy a pixel would otherwise draw
   *  as nothing at all, which reads as a broken bar rather than as a tiny one. */
  minPx?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(() => (prefersReducedMotion() ? pct : 0));

  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) { setW(pct); return; }
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      requestAnimationFrame(() => setW(pct));
    });
    io.observe(el);
    return () => io.disconnect();
  }, [pct]);

  return (
    <div ref={ref} className={`h-full ${className}`} style={{
      width: `${w}%`,
      minWidth: w > 0 && minPx ? `${minPx}px` : undefined,
      transition: prefersReducedMotion() ? undefined : `width ${ms}ms cubic-bezier(.22,1,.36,1)`,
    }} />
  );
}
