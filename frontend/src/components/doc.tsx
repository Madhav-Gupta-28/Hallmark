/**
 * The contract's building blocks. Everything on every page is made of these
 * plus type: a seal or stamp for a verdict, a clause for a term, a plain
 * underlined link for navigation, a signature line for who answers for what.
 *
 * Two inks, one meaning each: red refuses, blue honours.
 */
import type { CSSProperties, ReactNode } from "react";
import { Link, type LinkProps } from "react-router-dom";
import { cn } from "@/lib/utils";

type Ink = "red" | "blue";

/** A round notary seal. `slam` animates it landing; `tilt` in degrees. */
export function Seal({ ink = "red", top, big, bottom, size = 148, tilt = -12, slam = false, className }: {
  ink?: Ink; top?: ReactNode; big: ReactNode; bottom?: ReactNode;
  size?: number; tilt?: number; slam?: boolean; className?: string;
}) {
  return (
    <span
      className={cn("seal", ink === "blue" && "blue", slam && "slam", className)}
      style={{ "--s": `${size}px`, "--r": `${tilt}deg` } as CSSProperties}
      role="img"
      aria-label={[top, big, bottom].filter((x) => typeof x === "string" || typeof x === "number").join(" ")}
    >
      <span>{top}<big>{big}</big>{bottom}</span>
    </span>
  );
}

/** A rectangular rubber stamp, for a verdict inline with text. */
export function Stamp({ ink = "red", tilt = -2, children, className }: {
  ink?: Ink; tilt?: number; children: ReactNode; className?: string;
}) {
  return (
    <span className={cn("stamp", ink === "blue" && "blue", className)} style={{ "--r": `${tilt}deg` } as CSSProperties}>
      {children}
    </span>
  );
}

/** A numbered clause: the § in the margin, the heading in typewriter, the body in serif. */
export function Clause({ no, title, children, id }: { no: ReactNode; title?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <div className="clause" id={id}>
      <div className="no">{no}</div>
      <div className="body">
        {title && <h3>{title}</h3>}
        {children}
      </div>
    </div>
  );
}

/** A section heading inside a document: "SCHEDULE B — The vault". */
export function Heading({ kicker, children, className }: { kicker?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <header className={cn("mb-4 mt-14 double-rule pb-2", className)}>
      {kicker && <div className="label text-faint">{kicker}</div>}
      <h2 className="font-serif text-[clamp(28px,4vw,44px)] font-extrabold leading-[1.02] tracking-[-0.01em]">{children}</h2>
    </header>
  );
}

/** The plain, honest hyperlink — inside the app. */
export function L({ className, ...p }: LinkProps) {
  return <Link {...p} className={cn("lnk", className)} />;
}

/** The plain, honest hyperlink — out to the world. */
export function A({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return <a href={href} target="_blank" rel="noreferrer" className={cn("lnk", className)}>{children}<span aria-hidden> ↗</span></a>;
}

/** A label/value line, typewriter left, value right: Schedule entries. */
export function Entry({ k, v, className }: { k: ReactNode; v: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-6 border-b border-ink/25 py-2", className)}>
      <span className="label text-faint">{k}</span>
      <span className="text-right">{v}</span>
    </div>
  );
}

/** A signature block: the line, the name in handwriting above it, the role below. */
export function Signature({ name, role }: { name: ReactNode; role: ReactNode }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="hand truncate text-[28px] leading-none">{name}</div>
      <div className="sigline mt-1">{role}</div>
    </div>
  );
}

/** A small "the figure above is a live view call" source note. */
export function Source({ children }: { children: ReactNode }) {
  return <p className="typed mt-2 text-[12.5px] text-faint">↳ {children}</p>;
}
