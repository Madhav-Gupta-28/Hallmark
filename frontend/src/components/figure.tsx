/**
 * Exhibits for the long-form pages: a numbered figure with a one-line
 * takeaway a first-time reader can stop at, and the full clause folded
 * underneath for anyone who wants every word. Nothing is cut — it is ordered.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Figure({ no, title, takeaway, children, full, id, className }: {
  no: string; title: ReactNode; takeaway: ReactNode; children: ReactNode; full?: ReactNode; id?: string; className?: string;
}) {
  return (
    <section id={id} className={cn("mt-20 scroll-mt-6", className)}>
      <div className="flex items-baseline gap-3">
        <span className="label shrink-0 whitespace-nowrap bg-ink px-2 py-0.5 text-paper">Fig. {no}</span>
        <h2 className="font-serif text-[clamp(26px,3.4vw,40px)] font-extrabold leading-tight">{title}</h2>
      </div>
      <p className="mt-3 max-w-[820px] text-[clamp(20px,2.2vw,25px)] leading-snug">{takeaway}</p>
      <div className="mt-7">{children}</div>
      {full && <Full>{full}</Full>}
    </section>
  );
}

/** The fold: the whole clause, for whoever wants it. */
export function Full({ children, label = "Read the clause in full" }: { children: ReactNode; label?: string }) {
  return (
    <details className="group mt-6 border-t-2 border-ink">
      <summary className="typed flex cursor-pointer list-none items-center gap-2 py-3 text-[14px] font-bold uppercase tracking-wide hover:bg-hl [&::-webkit-details-marker]:hidden">
        <span className="inline-block transition-transform group-open:rotate-90" aria-hidden>▸</span> {label}
      </summary>
      <div className="max-w-[820px] pb-4 text-[17.5px] leading-[1.55] [&_p]:my-3">{children}</div>
    </details>
  );
}

/** An arrowhead marker for SVG figures, in either ink. */
export function Arrowheads() {
  return (
    <defs>
      {[["ink", "var(--ink)"], ["sign", "var(--sign)"], ["seal", "var(--seal)"], ["faint", "#11111155"]].map(([id, c]) => (
        <marker key={id} id={`ah-${id}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill={c} />
        </marker>
      ))}
    </defs>
  );
}
