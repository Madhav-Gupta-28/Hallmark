import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "./reveal";

/**
 * A figure that counts up to its value the first time it is seen, and eases to
 * any new value after that. The value itself always comes from the caller —
 * this only animates the path to it; the final frame is exactly `to`.
 */
export function Count({ to, ms = 900, format = (n: number) => Math.round(n).toLocaleString() }: {
  to: number; ms?: number; format?: (n: number) => string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const from = useRef(0);
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? to : 0));

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion()) { from.current = to; return; }
    const h = { raf: 0 };                      // the pending frame, cancelled on cleanup
    const run = () => {
      const start = performance.now(), a = from.current;
      const step = (t: number) => {
        const k = Math.min(1, (t - start) / ms);
        const v = a + (to - a) * (1 - Math.pow(1 - k, 3));
        setShown(k < 1 ? v : to);
        if (k < 1) h.raf = requestAnimationFrame(step); else from.current = to;
      };
      h.raf = requestAnimationFrame(step);
    };
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { io.disconnect(); run(); } });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(h.raf); };
  }, [to, ms]);

  // Under reduced motion there is no path to animate: always the value itself.
  return <span ref={ref} className="tabular-nums">{format(prefersReducedMotion() ? to : shown)}</span>;
}
