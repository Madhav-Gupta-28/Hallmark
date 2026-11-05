/**
 * Ink applied as you read.
 *
 * One hook, installed once at the root: every element matching REVEAL gets the
 * `rv` class (hidden, or un-drawn) and is shown — `in` — when it scrolls into
 * view, staggered with whatever arrives at the same moment. A MutationObserver
 * picks up content that renders late (everything here waits on the chain).
 *
 * It fails open: under prefers-reduced-motion it does nothing at all, and if
 * React rewrites an element's className the reveal classes simply disappear —
 * leaving the element visible, never stuck hidden.
 */
import { useEffect } from "react";

const REVEAL = [
  "main h1", "main h2", "main section > p", "main .clause", "main .sheet",
  ".ledger tbody tr", ".hl", ".struck", ".stamp", ".hand", "footer .sigline",
].join(",");

/** Never inside dialogs (portalled, and must appear at once) or the masthead's nav. */
const SKIP = "[role=dialog], nav, [data-no-reveal]";

export function prefersReducedMotion(): boolean {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useReveal(root: () => HTMLElement | null) {
  useEffect(() => {
    const el = root();
    if (!el || prefersReducedMotion() || typeof IntersectionObserver === "undefined") return;

    const seen = new WeakSet<Element>();
    const io = new IntersectionObserver((entries) => {
      let i = 0;
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const t = e.target as HTMLElement;
        t.style.setProperty("--d", `${Math.min(i++ * 70, 420)}ms`);
        t.classList.add("in");
        io.unobserve(t);
      }
    }, { rootMargin: "0px 0px -6% 0px", threshold: 0.05 });

    const scan = () => {
      el.querySelectorAll<HTMLElement>(REVEAL).forEach((n) => {
        if (seen.has(n) || n.closest(SKIP)) return;
        seen.add(n);
        n.classList.add("rv");
        io.observe(n);
      });
    };
    scan();

    let queued = false;
    const mo = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; scan(); });
    });
    mo.observe(el, { childList: true, subtree: true });

    return () => { mo.disconnect(); io.disconnect(); };
  }, [root]);
}

/** The reading rule across the top: how far down this page you are. */
export function useReadingProgress(bar: () => HTMLElement | null) {
  useEffect(() => {
    const b = bar();
    if (!b) return;
    let raf = 0;

    // Reading `scrollHeight` forces the browser to lay the document out. Doing
    // that inside the scroll handler means a forced reflow on every frame of
    // every scroll, on the longest pages on the site — exactly where it is
    // most expensive. The height only changes when content does, so measure it
    // then: on resize, and when the DOM mutates (these pages fill in from the
    // chain). Scrolling itself now only reads `scrollY`, which is free.
    let max = 0;
    const measure = () => { max = document.documentElement.scrollHeight - innerHeight; };

    const update = () => {
      raf = 0;
      // Short pages have nothing to read through; keep the rule hidden.
      const p = max > innerHeight * 0.6 ? Math.min(1, scrollY / max) : 0;
      b.style.transform = `scaleX(${p})`;
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(update); };

    // Coalesced to one measurement per frame. A page filling in from the chain
    // mutates many times in a row, and measuring on each one would put back the
    // very forced reflow this is here to remove.
    let pending = false;
    const remeasure = () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => { pending = false; measure(); update(); });
    };

    addEventListener("scroll", on, { passive: true });
    addEventListener("resize", remeasure);
    const mo = new MutationObserver(remeasure);
    mo.observe(document.body, { childList: true, subtree: true });

    measure();
    update();
    return () => {
      removeEventListener("scroll", on);
      removeEventListener("resize", remeasure);
      mo.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [bar]);
}
