import { useEffect, useState } from "react";
import { prefersReducedMotion } from "./reveal";

/** A line that types itself, then leaves its caret blinking. Full text is always in the accessible name. */
export function Typewriter({ text, cps = 38, delay = 250, className }: { text: string; cps?: number; delay?: number; className?: string }) {
  const [n, setN] = useState(() => (prefersReducedMotion() ? text.length : 0));
  useEffect(() => {
    if (prefersReducedMotion()) return;
    let i = 0, t: ReturnType<typeof setTimeout>;
    const tick = () => { i += 1; setN(i); if (i < text.length) t = setTimeout(tick, 1000 / cps); };
    t = setTimeout(tick, delay);
    return () => clearTimeout(t);
  }, [text, cps, delay]);
  return (
    <span className={className} aria-label={text}>
      <span aria-hidden className="caret">{text.slice(0, n)}</span>
    </span>
  );
}
