/* ============================================================================
   Hallmark — the shared runtime.

   No framework, no bundler, no dependency. Loaded as a module by every page.

   The load-bearing property, carried over from the original single-file proof
   page and not to be given up: **this code computes almost nothing.** It
   canonicalises a quote — deterministic key-sorting you can read in twenty
   lines — and then asks `hallmarkfi.near` for every number. The crypto, the
   arithmetic and the verdicts all come from the contract that guards real
   money, over a keyless view call. There is no server, so there is nothing to
   trust between you and the chain, and no number on any page that the page
   could have made up.
   ========================================================================= */

export const VAULT = "hallmarkfi.near";
export const RPC = "https://rpc.mainnet.near.org";
export const API = "https://1click.chaindefuser.com";
export const SIGNER = "ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc";
export const EXPLORER = "https://nearblocks.io";

/* ----------------------------------------------------------------- view calls */

/** A keyless `call_function` view. No key, no account, no deposit, no server. */
export async function view(method, args = {}) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "query",
      params: {
        request_type: "call_function", finality: "final", account_id: VAULT,
        method_name: method,
        args_base64: btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(args)))),
      },
    }),
  });
  const b = await r.json();
  if (b.error) throw new Error(`${method}: ${b.error.message ?? "rpc error"}`);
  if (b.result?.error) throw new Error(`${method}: ${b.result.error}`);
  return JSON.parse(new TextDecoder().decode(new Uint8Array(b.result.result)));
}

/** Account state straight off the chain — balance, storage, code hash. */
export async function viewAccount(id = VAULT) {
  const r = await fetch(RPC, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query",
      params: { request_type: "view_account", finality: "final", account_id: id } }),
  });
  const b = await r.json();
  if (b.error || !b.result) throw new Error("view_account failed");
  return b.result;
}

/* ------------------------------------------------------------ canonical form */

/**
 * Exactly the request fields 1Click's signature covers, in the SDK's own order.
 * The order does not matter — the keys get sorted — but keeping the SDK's list
 * verbatim makes the two sets easy to diff against the SDK by eye.
 */
const SIGNED_REQ = [
  "dry", "swapType", "slippageTolerance", "originAsset", "depositType",
  "destinationAsset", "amount", "refundTo", "refundType", "recipient",
  "recipientType", "deadline", "quoteWaitingTimeMs", "referral",
];

/** Exactly the quote fields it covers. */
const SIGNED_QUOTE = [
  "amountIn", "amountInFormatted", "amountInUsd", "minAmountIn",
  "amountOut", "amountOutFormatted", "amountOutUsd", "minAmountOut",
];

/**
 * `appFees` and `depositAddress` are absent on purpose — 1Click does not sign
 * either, so nothing in this project may read them. See ARCHITECTURE.md §3.2.
 */
export const UNSIGNED = [
  "appFees", "depositAddress", "depositMemo", "depositMode",
  "confidentiality", "insured", "timeEstimate", "refundFee",
  "withdrawFee", "correlationId",
];

/** JSON with keys sorted and `undefined` dropped — `json-stable-stringify`. */
export function stable(o) {
  if (o === null || typeof o !== "object") return JSON.stringify(o);
  if (Array.isArray(o)) return "[" + o.map(stable).join(",") + "]";
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stable(o[k])).join(",") + "}";
}

/** The exact byte string the venue signed, and that the contract re-hashes. */
export function canonicalise(res) {
  const p = {};
  for (const k of SIGNED_REQ) {
    const v = res.quoteRequest[k];
    // 1Click drops falsy `quoteWaitingTimeMs` and `referral` before signing.
    if (k === "quoteWaitingTimeMs" || k === "referral") { if (v) p[k] = v; continue; }
    if (v !== undefined && v !== null) p[k] = v;
  }
  for (const k of SIGNED_QUOTE) {
    const v = res.quote[k];
    if (v !== undefined && v !== null) p[k] = v;
  }
  p.timestamp = res.timestamp;
  return stable(p);
}

/* -------------------------------------------------------------- 1Click, maybe
   The venue can be down — it answered HTTP 521 for forty minutes on
   2026-11-02, and then served `/v0/tokens` while refusing every quote. So every
   call through here reports what actually happened rather than "something went
   wrong", and the pages that need nothing from the venue keep working. */

export async function getTokens() {
  const r = await fetch(`${API}/v0/tokens`);
  if (!r.ok) throw new Error(`the 1Click token list is unavailable (HTTP ${r.status})`);
  return r.json();
}

export async function getQuote(p) {
  const r = await fetch(`${API}/v0/quote`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      dry: true, swapType: "EXACT_INPUT",
      slippageTolerance: p.slippageTolerance ?? 100,
      originAsset: p.originAsset, depositType: "ORIGIN_CHAIN",
      destinationAsset: p.destinationAsset, amount: p.amount,
      refundTo: p.recipient, refundType: "ORIGIN_CHAIN",
      recipient: p.recipient, recipientType: "DESTINATION_CHAIN",
      deadline: p.deadline ?? new Date(Date.now() + 36e5).toISOString(),
    }),
  });
  const text = await r.text();
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try { msg = JSON.parse(text).message || msg; } catch {}
    throw new Error(`1Click will not quote this right now — ${msg}`);
  }
  return JSON.parse(text);
}

/* ------------------------------------------------------------------ fixtures
   The signed captures, loaded from a file generated out of contract/fixtures/
   by web/assets/mkfixtures.py. Never transcribed by hand: one wrong byte in the
   canonical form makes `is_signed` answer false on a genuinely signed quote,
   which would make the site wrong about the only thing it exists to show. */

let _fx;
export async function fixtures() {
  if (!_fx) {
    const r = await fetch("assets/fixtures.json");
    if (!r.ok) throw new Error("assets/fixtures.json is missing — run web/assets/mkfixtures.py");
    _fx = await r.json();
  }
  return _fx;
}

/* -------------------------------------------------------------------- format */

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Base units to a human string, exactly — never via a float. */
export function units(v, dp, places = 6) {
  const s = BigInt(v).toString().padStart(dp + 1, "0");
  const whole = s.slice(0, s.length - dp);
  const frac = dp ? s.slice(s.length - dp) : "";
  return places ? `${whole}.${frac.slice(0, places).padEnd(places, "0")}` : whole;
}

export function age(secs) {
  const n = Number(secs);
  if (n < 120) return `${n}s`;
  if (n < 7200) return `${Math.round(n / 60)} min`;
  if (n < 172800) return `${(n / 3600).toFixed(1)} h`;
  return `${(n / 86400).toFixed(1)} days`;
}

export const near = (yocto, dp = 5) => (Number(BigInt(yocto)) / 1e24).toFixed(dp);
export const tx = (h) => `${EXPLORER}/txns/${h}`;
export const short = (s, n = 10) => (s.length > n * 2 ? `${s.slice(0, n)}…${s.slice(-6)}` : s);

export const rows = (list) =>
  list.map(([k, v]) => `<div class="row"><span class="k">${k}</span><span class="v">${v}</span></div>`).join("");

/* ------------------------------------------------------------------- chrome */

const PAGES = [
  ["index.html", "Overview"],
  ["exploit.html", "The exploit"],
  ["mechanism.html", "Mechanism"],
  ["proof.html", "Check it yourself"],
  ["contract.html", "Contract"],
  ["fillers.html", "Fillers"],
  ["limits.html", "Limits"],
];

/** The assay mark: a hallmark cartouche with a punch inside it. */
export const MARK = `<svg width="19" height="19" viewBox="0 0 24 24" aria-hidden="true">
  <path d="M12 2.4 20.4 7v10L12 21.6 3.6 17V7Z" fill="none" stroke="var(--gold)" stroke-width="1.5"/>
  <path d="M12 7.6 16 10v4l-4 2.4L8 14v-4Z" fill="var(--gold)" opacity=".85"/>
</svg>`;

function chrome() {
  const here = location.pathname.split("/").pop() || "index.html";
  const links = PAGES.map(
    ([h, t]) => `<a class="nl" href="${h}"${h === here ? ' aria-current="page"' : ""}>${t}</a>`
  ).join("");
  const nav = document.createElement("header");
  nav.className = "nav";
  nav.innerHTML = `<div class="nav-in">
      <a class="brand" href="index.html">${MARK}<span>hallmark</span></a>
      <button class="nav-toggle" aria-label="Menu" aria-expanded="false">≡</button>
      <div class="spacer"></div>
      <nav class="nav-links" aria-label="Sections">${links}</nav>
      <button class="theme-btn" aria-label="Switch theme" title="Switch theme">◐</button>
    </div>`;
  document.body.prepend(nav);

  nav.querySelector(".nav-toggle").onclick = (e) => {
    const l = nav.querySelector(".nav-links");
    l.classList.toggle("open");
    e.currentTarget.setAttribute("aria-expanded", l.classList.contains("open"));
  };
  nav.querySelector(".theme-btn").onclick = () => {
    const dark = !(document.documentElement.dataset.theme === "dark");
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    try { localStorage.setItem("hm-theme", dark ? "dark" : "light"); } catch {}
  };

  const foot = document.createElement("footer");
  foot.className = "foot";
  foot.innerHTML = `<div class="wrap"><div class="foot-in">
      <div>Hallmark — a not-held order that enforces its own execution bound.<br>
        <span class="dim2">Live on NEAR mainnet at
        <a href="${EXPLORER}/address/${VAULT}" target="_blank" rel="noopener">${VAULT}</a>.
        Every figure on this site is a keyless view call to that contract.</span></div>
      <nav class="foot-nav" aria-label="Footer">${PAGES.map(([h, t]) => `<a href="${h}">${t}</a>`).join("")}</nav>
    </div></div>`;
  document.body.append(foot);
}

/** Reveal on scroll. Suppressed entirely under prefers-reduced-motion by CSS. */
function reveal() {
  const io = new IntersectionObserver(
    (es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }),
    { rootMargin: "0px 0px -8% 0px", threshold: 0.04 }
  );
  document.querySelectorAll(".rv").forEach((n) => io.observe(n));
}

/** Count a figure up to its value. Explains nothing, so it is kept to 600ms
 *  and only used where it draws the eye to the number that matters. */
export function odometer(el, to, fmt = (v) => Math.round(v).toLocaleString()) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { el.textContent = fmt(to); return; }
  const t0 = performance.now(), d = 600;
  const step = (t) => {
    const k = Math.min(1, (t - t0) / d);
    el.textContent = fmt(to * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

(function init() {
  try {
    const saved = localStorage.getItem("hm-theme");
    if (saved) document.documentElement.dataset.theme = saved;
  } catch {}
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { chrome(); reveal(); });
  } else { chrome(); reveal(); }
})();
