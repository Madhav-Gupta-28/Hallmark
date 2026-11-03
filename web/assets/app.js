/* ============================================================================
   Hallmark — the app.

   Four things a person can actually do, in the order the product makes sense:
   read the book, price a fill against a live mandate, post a mandate, manage a
   position.

   The rule this file follows everywhere: **a read is free and a write is
   explicit.** Panels 01, 02 and the whole of 04's reporting are keyless view
   calls — no wallet, no key, no server, nothing to approve. The two actions that
   spend money each render the exact transaction they would send and the exact
   `near` command that sends it, from the same builder, before they will do
   anything. Nothing on this page can move funds that it has not first shown you.
   ========================================================================= */

import {
  view, viewAccount, getTokens, getQuote, canonicalise, fixtures,
  rows, esc, units, age, near, parseUnits, tokenOf, cliFor,
  txStorageDeposit, txOpen, txFill, txWithdraw, txCancel, txReap, txStorageWithdraw,
  VAULT, EXPLORER, UNSIGNED,
} from "./hallmark.js?v=067aeb46";

const $ = (s) => document.querySelector(s);
const NS_PER_DAY = 86_400_000_000_000n;

/* Token decimals. Needed to turn base units into something readable and back.
   The venue is the authority on this, but it can be down, so the pair this
   vault is actually used with is hard-coded as a floor and anything the venue
   reports merges over the top. */
const DP = { "nep141:wrap.near": 24, "nep141:usdt.tether-token.near": 6 };
const SYM = { "nep141:wrap.near": "wNEAR", "nep141:usdt.tether-token.near": "USDT" };
const dp = (a) => DP[a] ?? 18;
const sym = (a) => SYM[a] ?? tokenOf(a).split(".")[0].toUpperCase();
let tokensOk = false;

/* ------------------------------------------------------------------- health */

(async () => {
  const cells = [];
  try {
    const [acct, open] = await Promise.all([viewAccount(), view("open_mandate_count")]);
    cells.push(`<span class="dot pulse"></span>NEAR mainnet · <b>${VAULT}</b> ·
      ${near(acct.amount, 3)} NEAR · ${open} open mandate${Number(open) === 1 ? "" : "s"}`);
  } catch (e) {
    cells.push(`<span class="refuse">NEAR RPC unreachable — ${esc(e.message)}</span>`);
  }
  try {
    const toks = (await getTokens()).filter((t) => t.blockchain === "near");
    for (const t of toks) { DP[t.assetId] = t.decimals; SYM[t.assetId] = t.symbol; }
    tokensOk = true;
    cells.push(`<span class="tag live">1Click responding · ${toks.length} NEAR assets</span>`);
  } catch (e) {
    cells.push(`<span class="tag no">1Click unavailable</span>
      <span class="dim2">${esc(e.message)} — the book and every verdict below still work.</span>`);
  }
  $("#health").innerHTML =
    `<div style="font-size:13px;display:flex;gap:14px;flex-wrap:wrap;align-items:center">${cells.join("")}</div>`;
  fillAssetPickers();
})();

/* ------------------------------------------------------------------- wallet
   Loaded lazily. Until someone clicks Connect, assets/wallet.js — and the
   library it pulls in — is never fetched, so the page stays as dependency-free
   in practice as the rest of the site is by construction. */

let W = null;                 // the wallet module, once imported
let ME = null;                // the signed-in account id

async function walletModule() {
  if (!W) W = await import("./wallet.js?v=929f9312");
  return W;
}

function paintWallet() {
  $("#who").innerHTML = ME
    ? `<span class="dot"></span>signed in as <b>${esc(ME)}</b>`
    : "Not connected";
  $("#wbtn").textContent = ME ? "Disconnect" : "Connect wallet";
  if (ME && !$("#acct").value) { $("#acct").value = ME; lookup(); }
  renderOpenTx();
}

$("#wbtn").onclick = async () => {
  const b = $("#wbtn"); b.disabled = true;
  try {
    const w = await walletModule();
    if (ME) { await w.disconnect(); ME = null; }
    else { w.onAccount((id) => { ME = id; paintWallet(); }); await w.connect(); ME = w.accountId(); }
    paintWallet();
  } catch (e) {
    $("#who").innerHTML = `<span class="refuse">${esc(e.message)}</span>`;
  } finally { b.disabled = false; }
};

/** Sign a batch if a wallet is connected; otherwise say what to do instead. */
async function send(txs, statusEl, label) {
  if (!ME) {
    statusEl.innerHTML = `<span class="refuse">connect a wallet, or copy the command above and run it yourself</span>`;
    return null;
  }
  statusEl.innerHTML = `signing ${label}…`;
  try {
    const w = await walletModule();
    const r = await w.signAndSend(txs);
    // MyNearWallet redirects away to sign and may never resolve here; a result
    // that does come back is an array of final execution outcomes.
    const h = Array.isArray(r) ? r[r.length - 1]?.transaction?.hash : r?.transaction?.hash;
    statusEl.innerHTML = h
      ? `<span class="allow">sent —</span> <a href="${EXPLORER}/txns/${esc(h)}" target="_blank" rel="noopener">${esc(h.slice(0, 12))}…</a>`
      : `<span class="allow">sent.</span> re-reading the chain…`;
    return r;
  } catch (e) {
    statusEl.innerHTML = `<span class="refuse">${esc(e.message || "the wallet refused or the user cancelled")}</span>`;
    return null;
  }
}

/* ------------------------------------------------- the exact transaction box */

/** Render a batch as the receiver/method/args it is, plus a runnable command. */
function txBox(txs) {
  const acts = txs.flatMap((t) => t.actions.map((a) => [t, a]));
  const table = acts.map(([t, a]) => `
    <div class="panel" style="padding:13px 15px;margin:0 0 9px">${rows([
      ["receiver", `<code>${esc(t.receiverId)}</code>${t.receiverId === VAULT ? "" : ` <span class="dim2">← the token, not the vault</span>`}`],
      ["method", `<code>${esc(a.methodName)}</code>`],
      ["gas", `${Number(BigInt(a.gas) / 1_000_000_000_000n)} TGas`],
      ["deposit", a.deposit === "1" ? "1 yoctoNEAR" : a.deposit === "0" ? "0" : `${near(a.deposit, 5)} NEAR`],
    ])}
      <pre style="margin:9px 0 0"><code>${esc(JSON.stringify(a.args, null, 1))}</code></pre>
    </div>`).join("");
  const cmd = cliFor(txs, ME || "YOUR_ACCOUNT.near");
  return `${table}
    <div class="controls" style="margin:13px 0 7px"><button class="copy" data-cmd>copy command</button>
      <span class="dim2" style="font-size:12px">runs with the NEAR CLI · signs with your keychain, never with this page</span></div>
    <pre><code>${esc(cmd)}</code></pre>`;
}

/* Delegated copy handling, so a box can be re-rendered freely. */
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-cmd]");
  if (!b) return;
  const pre = b.closest("div").parentElement.querySelector("pre:last-of-type");
  try {
    await navigator.clipboard.writeText(pre.textContent);
    const was = b.textContent; b.textContent = "copied"; setTimeout(() => (b.textContent = was), 1200);
  } catch { b.textContent = "select it manually"; }
});

/* ==================================================== 01 · the open book === */

let BOOK = [];

async function loadBook() {
  const g = $("#bookgrid");
  try {
    BOOK = await view("get_mandates", {});
    if (!BOOK.length) {
      g.innerHTML = `<div class="empty" style="grid-column:1/-1">
        The vault holds no open mandate right now. Post one in
        <a href="#post">section 03</a> and it appears here.</div>`;
      $("#booksrc").innerHTML = "";
      fillMandatePicker();
      return;
    }
    const now = BigInt(Date.now()) * 1_000_000n;
    g.innerHTML = BOOK.map(([id, m]) => {
      const t = m.terms;
      const left = (BigInt(t.expiry_ns) - now) / NS_PER_DAY;
      const used = Number(m.worst_bps), ceil = Number(t.max_cost_bps);
      return `<article class="mcard" data-id="${id}">
        <div class="mcard-h">
          <span class="id">#${id}</span>
          <span class="pair">${esc(sym(t.origin_asset))} → ${esc(sym(t.destination_asset))}</span>
          <span class="grow" style="flex:1 1 auto"></span>
          <span class="tag live">open</span>
        </div>
        <div class="mcard-b">${rows([
          ["worst all-in cost allowed", `<b>${ceil} bps</b>`],
          ["escrow left", `${units(m.escrow, dp(t.origin_asset), 6)} <span class="dim2">${esc(sym(t.origin_asset))}</span>`],
          ["biggest single fill", `${units(t.max_fill, dp(t.origin_asset), 6)} <span class="dim2">${esc(sym(t.origin_asset))}</span>`],
          ["quote must be fresher than", `${age(t.max_quote_age_secs)}`],
          ["fills so far", `${m.fills}${m.fills ? ` <span class="dim2">· delivered ${units(m.delivered, dp(t.destination_asset), 6)} ${esc(sym(t.destination_asset))}</span>` : ""}`],
          ["worst fill actually taken", m.fills
            ? `<span class="allow"><b>${used} bps</b></span> <span class="dim2">of ${ceil} allowed</span>`
            : `<span class="dim2">none yet</span>`],
          ["expires", left > 0n ? `in ${left} days` : `<span class="refuse">expired</span>`],
          ["owner", `<span class="mono" style="font-size:11.5px">${esc(m.owner.length > 20 ? m.owner.slice(0, 10) + "…" + m.owner.slice(-6) : m.owner)}</span>`],
        ])}</div>
        <div class="mcard-f">
          <a class="btn" href="#price" data-price="${id}">Price a fill against #${id} →</a>
        </div>
      </article>`;
    }).join("");
    $("#booksrc").innerHTML = `↳ <code>get_mandates</code> on <b>${VAULT}</b>, read just now.
      The index behind it is keyed on the open mandates only, so this call costs what the
      vault <i>holds</i> rather than everything it has ever remembered.`;
  } catch (e) {
    g.innerHTML = `<div class="empty" style="grid-column:1/-1"><span class="refuse">${esc(e.message)}</span></div>`;
  }
  fillMandatePicker();
}

/* Clicking through from a card selects that mandate upstairs. */
document.addEventListener("click", (e) => {
  const a = e.target.closest("[data-price]");
  if (!a) return;
  $("#pm").value = a.dataset.price;
  document.querySelectorAll(".mcard").forEach((c) => c.classList.toggle("sel", c.dataset.id === a.dataset.price));
});

/* ==================================================== 02 · price a fill ==== */

function fillMandatePicker() {
  const s = $("#pm");
  if (!BOOK.length) {
    s.innerHTML = `<option value="">no open mandate to price</option>`;
    $("#pgo").disabled = true;
    return;
  }
  s.innerHTML = BOOK.map(([id, m]) =>
    `<option value="${id}">#${id} · ${esc(sym(m.terms.origin_asset))} → ${esc(sym(m.terms.destination_asset))} · ${m.terms.max_cost_bps} bps · ${age(m.terms.max_quote_age_secs)} freshness</option>`
  ).join("");
  $("#pgo").disabled = false;
}

/** The contract's verdict, verbatim, plus a readable gloss of its raw units.
 *  The string itself is never rewritten — it is what the chain said — but
 *  "earns 40000000000000000000000 origin units" helps nobody on its own. */
function gloss(v, asset) {
  const m = v.match(/earns (\d+) origin units/);
  if (!m) return esc(v);
  return esc(v) + ` <span class="dim2">(= ${units(m[1], dp(asset), 6)} ${esc(sym(asset))})</span>`;
}

/** The verdict table. `terms` are the mandate's REAL terms, straight off chain. */
async function verdict(into, canonical, signature, terms, mandateId) {
  const q = JSON.parse(canonical);
  const outDp = dp(terms.destination_asset);
  const fillable = BigInt(q.amountIn) <= BigInt(terms.max_fill);

  const [signed, worst, full, ageS, vFloor, vFull] = await Promise.all([
    view("is_signed", { canonical, signature }),
    view("worst_cost", { canonical }),
    view("realised_cost", { canonical, delivered: q.amountOut }),
    view("quote_age_secs", { canonical }),
    view("dry_check", { canonical, signature, terms, delivered: q.minAmountOut }),
    view("dry_check", { canonical, signature, terms, delivered: q.amountOut }),
  ]);

  const leaked = UNSIGNED.filter((u) => canonical.includes(u));
  const ceil = Number(terms.max_cost_bps);
  const ok = vFull.startsWith("ALLOWED");
  const pct = Math.min(100, (Number(worst) / Math.max(ceil, Number(worst))) * 100);

  const fillTx = mandateId != null
    ? [txFill(terms.destination_asset, Number(mandateId), canonical, signature, q.minAmountOut)]
    : null;

  into.innerHTML = `
    <div class="panel">${rows([
      ["signed by NEAR Intents?", signed
        ? `<span class="allow">yes — valid ed25519 over these exact bytes</span>`
        : `<span class="refuse">NO — these are not the bytes the venue signed</span>`],
      ["unsigned field inside the signed bytes?", leaked.length
        ? `<span class="refuse">${leaked.join(", ")}</span>`
        : `<span class="allow">none</span>`],
      ["in", `$${Number(q.amountInUsd).toFixed(4)} <span class="dim2">· ${units(q.amountIn, dp(terms.origin_asset), 6)} ${esc(sym(terms.origin_asset))}</span>`],
      ["out, if honoured in full", `$${Number(q.amountOutUsd).toFixed(4)} <span class="dim2">· ${units(q.amountOut, outDp, 6)} ${esc(sym(terms.destination_asset))}</span>`],
      ["out, guaranteed floor", `<span class="dim2">${units(q.minAmountOut, outDp, 6)} ${esc(sym(terms.destination_asset))}</span>`],
      ["signed at <span class='dim2'>← written by the venue, inside the signature</span>",
        `${esc(q.timestamp)} <span class="${Number(ageS) > Number(terms.max_quote_age_secs) ? "refuse" : "allow"}">${age(ageS)} ago</span>`],
      ["deadline <span class='dim2'>← chosen by whoever asked for the quote</span>", `<span class="dim2">${esc(q.deadline)}</span>`],
      ["size against this mandate's cap", fillable
        ? `<span class="allow">within ${units(terms.max_fill, dp(terms.origin_asset), 6)}</span>`
        : `<span class="refuse">over the ${units(terms.max_fill, dp(terms.origin_asset), 6)} cap</span>`],
      ["cost if honoured in full", `<span style="font-size:21px;font-weight:650" class="${Number(full) > ceil ? "hi" : ""}">${full} bps</span>`],
      ["guaranteed&#8209;worst all&#8209;in cost", `<span class="${Number(worst) > ceil ? "refuse" : "allow"}" style="font-size:21px;font-weight:650">${worst} bps</span>`],
    ])}
      <div class="bar">
        <div class="bar-fill ${Number(worst) > ceil ? "over" : ""}" style="width:${pct}%"></div>
        <div class="bar-ceil" style="left:${Math.min(100, (ceil / Math.max(ceil, Number(worst))) * 100)}%" data-ceil="${ceil} bps ceiling"></div>
        <div class="bar-txt"><b>${worst} bps</b> guaranteed worst · ceiling <b>${ceil} bps</b></div>
      </div>
    </div>

    <div class="verdict ${ok ? "ok" : "no"}" style="margin-top:14px"><b>at the expected fill</b> &nbsp;${gloss(vFull, terms.origin_asset)}</div>
    <div class="verdict ${vFloor.startsWith("ALLOWED") ? "ok" : "no"}"><b>at the signed floor</b> &nbsp;${gloss(vFloor, terms.origin_asset)}</div>

    <p class="src">↳ every figure above was answered by <b>${VAULT}</b> on NEAR mainnet,
      against mandate ${mandateId != null ? `<b>#${mandateId}</b>'s real terms` : "the terms shown"} —
      a ${ceil}&nbsp;bps ceiling and a ${terms.max_quote_age_secs}&nbsp;s freshness bound.
      The gap between the last two cost rows is the entire product.</p>

    ${fillTx ? `<div class="act" style="margin-top:20px">
      <h4>Fill mandate #${mandateId}</h4>
      <p class="why">
        Deliver ${units(q.minAmountOut, outDp, 6)} ${esc(sym(terms.destination_asset))} to the vault
        with this quote in <code>msg</code>. The delivery <i>is</i> the fill: the vault verifies
        synchronously and credits you ${units(q.amountIn, dp(terms.origin_asset), 6)}
        ${esc(sym(terms.origin_asset))} only if the arithmetic holds. If it does not, your tokens
        come straight back${ok ? "" : " — which, on this quote, is exactly what would happen"}.
      </p>
      <div class="controls" style="margin:0"><button class="btn ${ok ? "primary" : ""}" id="fbtn">${ok ? "Fill it" : "Try it anyway — watch it refuse"}</button>
        <span class="dim2" id="fstat" style="font-size:12.5px"></span></div>
      <details class="txd" open><summary>the exact transaction this sends</summary>${txBox(fillTx)}</details>
    </div>` : ""}`;

  if (fillTx) $("#fbtn").onclick = () => send(fillTx, $("#fstat"), "the fill").then(() => setTimeout(loadBook, 2500));
}

$("#pgo").onclick = async () => {
  const b = $("#pgo"), out = $("#pout");
  b.disabled = true; b.textContent = "asking the venue…";
  try {
    const id = $("#pm").value;
    const entry = BOOK.find(([i]) => String(i) === String(id));
    if (!entry) throw new Error("that mandate is no longer open — reload the book");
    const [, m] = entry;
    const t = m.terms;
    // Quote the largest fill this mandate will actually take.
    const amount = (BigInt(m.escrow) < BigInt(t.max_fill) ? BigInt(m.escrow) : BigInt(t.max_fill)).toString();
    if (amount === "0") throw new Error("this mandate has no escrow left to fill against");
    const res = await getQuote({
      originAsset: t.origin_asset, destinationAsset: t.destination_asset,
      amount, recipient: t.recipient,
    });
    await verdict(out, canonicalise(res), res.signature.replace(/^ed25519:/, ""), t, id);
  } catch (e) {
    out.innerHTML = `<div class="verdict no">${esc(e.message)}</div>
      <p class="src">↳ nothing was signed and nothing moved. Try the captured quote instead — it needs no venue.</p>`;
  } finally { b.disabled = false; b.textContent = "Get a live quote"; }
};

$("#pfx").onclick = async () => {
  const out = $("#pout");
  out.innerHTML = `<p class="dim">replaying the capture…</p>`;
  try {
    const FX = await fixtures();
    const f = FX.worst ?? Object.values(FX)[0];
    const q = JSON.parse(f.canonical);
    const id = $("#pm").value;
    const entry = BOOK.find(([i]) => String(i) === String(id));
    // Price it against a live mandate's terms when the pair matches, so the
    // comparison is honest; otherwise against the capture's own pair.
    const useLive = entry && entry[1].terms.origin_asset === q.originAsset
                          && entry[1].terms.destination_asset === q.destinationAsset;
    const terms = useLive ? entry[1].terms : {
      origin_asset: q.originAsset, destination_asset: q.destinationAsset,
      recipient: q.recipient, max_cost_bps: 300, max_fill: q.amountIn,
      max_quote_age_secs: 300, expiry_ns: "4000000000000000000",
    };
    await verdict(out, f.canonical, f.signature, terms, useLive ? id : null);
    out.insertAdjacentHTML("afterbegin",
      `<div class="panel ok" style="margin-bottom:14px"><b>A captured quote carrying a 500 bps hidden fee.</b>
        It is genuinely signed by NEAR Intents — the signature below verifies. The fee lives in
        <code>appFees</code>, which the venue does <b>not</b> sign, so the contract never reads
        that field. It does not need to: the cost is already visible in the four numbers that
        <i>are</i> signed. ${useLive ? `Priced here against live mandate #${id}'s real terms.` : ""}</div>`);
  } catch (e) {
    out.innerHTML = `<div class="verdict no">${esc(e.message)}</div>`;
  }
};

/* ==================================================== 03 · post a mandate == */

function fillAssetPickers() {
  const ids = Object.keys(DP).sort((a, b) => sym(a).localeCompare(sym(b)));
  const opts = ids.map((a) => `<option value="${a}">${esc(sym(a))}</option>`).join("");
  /* Replacing a select's options makes the browser select the first one, so a
     previous choice has to be captured BEFORE the swap and restored after —
     reading `.value` afterwards would always look like a deliberate choice and
     would leave both pickers on the same asset, which the contract refuses. */
  for (const [el, want] of [[$("#oin"), "nep141:wrap.near"], [$("#oout"), "nep141:usdt.tether-token.near"]]) {
    const was = el.dataset.picked;
    el.innerHTML = opts;
    el.value = (was && ids.includes(was)) ? was
             : ids.includes(want) ? want
             : ids[el === $("#oout") && ids.length > 1 ? 1 : 0];
    el.dataset.picked = el.value;
  }
  if (!tokensOk && !$("#oin").parentElement.querySelector(".fallback")) {
    $("#oin").insertAdjacentHTML("afterend",
      `<span class="hint fallback">the venue's token list is unavailable, so this is the pair the vault is known to hold</span>`);
  }
  renderOpenTx();
}

/** The form's current state as a Mandate, or an error explaining why not. */
function readForm() {
  const origin_asset = $("#oin").value, destination_asset = $("#oout").value;
  if (!origin_asset || !destination_asset) throw new Error("pick both assets");
  if (origin_asset === destination_asset)
    throw new Error("the two assets must differ — the contract refuses a mandate that swaps a token for itself");
  const amount = parseUnits($("#oamt").value || "0", dp(origin_asset));
  if (amount === "0") throw new Error("escrow something above zero");
  const bps = Number($("#obps").value);
  if (!Number.isInteger(bps) || bps < 1 || bps > 10000)
    throw new Error("the cost ceiling must be a whole number of bps between 1 and 10000");
  const ageS = Number($("#oage").value);
  if (!Number.isInteger(ageS) || ageS < 1 || ageS > 2_592_000)
    throw new Error("the freshness bound must be between 1 second and 30 days, in seconds");
  const days = Number($("#odays").value);
  if (!Number.isInteger(days) || days < 1 || days > 3650)
    throw new Error("expiry must be a whole number of days");
  const terms = {
    origin_asset, destination_asset,
    recipient: ME || VAULT,
    max_cost_bps: bps,
    max_fill: amount,
    max_quote_age_secs: ageS,
    expiry_ns: String(BigInt(Date.now()) * 1_000_000n + BigInt(days) * NS_PER_DAY),
  };
  return { terms, amount };
}

async function openTxs() {
  const { terms, amount } = readForm();
  const est = await view("storage_cost_estimate").catch(() => "10240000000000000000000");
  const have = ME ? await view("storage_balance_of", { account_id: ME }).catch(() => "0") : "0";
  const txs = [];
  if (BigInt(have) < BigInt(est)) txs.push(txStorageDeposit(est));
  txs.push(txOpen(terms, amount));
  return { txs, terms, prepaid: BigInt(have) >= BigInt(est) };
}

async function renderOpenTx() {
  const box = $("#otx"); if (!box) return;
  try {
    const { txs, terms, prepaid } = await openTxs();
    box.innerHTML =
      (prepaid ? `<p class="src" style="margin:0 0 10px">↳ ${esc(ME)} has already prepaid its storage, so the
         <code>storage_deposit</code> step is not needed — one transaction.</p>` : "")
      + `<p class="src" style="margin:0 0 10px">↳ the terms being welded on:
         <code>${esc(JSON.stringify(terms))}</code></p>`
      + txBox(txs);
    $("#ostat").innerHTML = ME ? "" : `<span class="dim2">recipient defaults to the vault until a wallet is connected</span>`;
  } catch (e) {
    box.innerHTML = `<div class="verdict no">${esc(e.message)}</div>`;
  }
}

for (const id of ["#oin", "#oout", "#oamt", "#obps", "#oage", "#odays"]) {
  const el = $(id);
  el.addEventListener("change", () => { if (el.tagName === "SELECT") el.dataset.picked = el.value; renderOpenTx(); });
  el.addEventListener("input", () => { clearTimeout(el._t); el._t = setTimeout(renderOpenTx, 350); });
}

$("#obtn").onclick = async () => {
  $("#otxd").open = true;
  try {
    const { txs } = await openTxs();
    await send(txs, $("#ostat"), "the mandate");
    setTimeout(loadBook, 3000);
  } catch (e) { $("#ostat").innerHTML = `<span class="refuse">${esc(e.message)}</span>`; }
};

/* ==================================================== 04 · your position === */

async function lookup() {
  const who = $("#acct").value.trim();
  const out = $("#yout");
  if (!who) { out.innerHTML = `<div class="empty">type an account to look up — it needs no wallet.</div>`; return; }
  out.innerHTML = `<p class="dim">reading the chain…</p>`;
  try {
    const assets = [...new Set(BOOK.flatMap(([, m]) => [m.terms.origin_asset, m.terms.destination_asset]))];
    if (!assets.length) assets.push("nep141:wrap.near", "nep141:usdt.tether-token.near");

    const [storage, est, ...credits] = await Promise.all([
      view("storage_balance_of", { account_id: who }),
      view("storage_cost_estimate"),
      ...assets.map((a) => view("get_credit", { account_id: who, asset: a })),
    ]);

    const owed = assets.map((a, i) => [a, credits[i]]).filter(([, v]) => BigInt(v) > 0n);
    const mine = BOOK.filter(([, m]) => m.owner === who);

    out.innerHTML = `
      <div class="grid g2">
        <div class="panel"><h3 style="margin-top:0">Withdrawable</h3>
          ${owed.length ? rows(owed.map(([a, v]) =>
              [`<code>${esc(sym(a))}</code>`, `<b>${units(v, dp(a), 6)}</b>`]))
            : `<p class="dim" style="margin:0">Nothing owed to this account. A fill credits the filler the
               mandate's input token; the owner is credited anything a cancel returns.</p>`}
          ${owed.map(([a]) => `<div class="act" style="margin-top:14px">
            <h4>Withdraw ${esc(sym(a))}</h4>
            <p class="why">Pulls the whole credit to ${esc(who)}. Pull, not push — so nobody's
              unregistered token account can wedge a fill for anyone else.</p>
            <div class="controls" style="margin:0"><button class="btn primary" data-wd="${esc(a)}">Withdraw</button>
              <span class="dim2" data-wds="${esc(a)}" style="font-size:12.5px"></span></div>
            <details class="txd"><summary>the exact transaction</summary>${txBox([txWithdraw(a)])}</details>
          </div>`).join("")}
        </div>

        <div class="panel"><h3 style="margin-top:0">Prepaid storage</h3>
          ${rows([
            ["balance", `<b>${near(storage, 5)} NEAR</b>`],
            ["one mandate needs about", `${near(est, 5)} NEAR`],
            ["enough for another mandate?", BigInt(storage) >= BigInt(est)
              ? `<span class="allow">yes</span>` : `<span class="refuse">no — prepay first</span>`],
          ])}
          <p class="src">↳ whoever causes a byte to be written pays for that byte, measured. Without
            this the vault would stake its own balance against every stranger's record, and ten cents
            of gas could stop it writing state at all.</p>
          ${BigInt(storage) > 0n ? `<div class="act" style="margin-top:14px">
            <h4>Withdraw unused storage</h4>
            <p class="why">Returns whatever is not currently staked against live records.</p>
            <div class="controls" style="margin:0"><button class="btn" id="swbtn">Withdraw it</button>
              <span class="dim2" id="swstat" style="font-size:12.5px"></span></div>
            <details class="txd"><summary>the exact transaction</summary>${txBox([txStorageWithdraw()])}</details>
          </div>` : ""}
        </div>
      </div>

      <h3 style="margin-top:34px">Mandates owned</h3>
      ${mine.length ? mine.map(([id, m]) => `<div class="act" style="margin-top:14px">
          <h4>#${id} · ${esc(sym(m.terms.origin_asset))} → ${esc(sym(m.terms.destination_asset))} · ${m.terms.max_cost_bps} bps</h4>
          <p class="why">${units(m.escrow, dp(m.terms.origin_asset), 6)}
            ${esc(sym(m.terms.origin_asset))} still escrowed across ${m.fills} fill${m.fills === 1 ? "" : "s"}.
            <b>Cancel</b> closes it and credits the remaining escrow back to you; <b>reap</b> then deletes the
            record and refunds the storage it actually frees, measured.</p>
          <div class="controls" style="margin:0">
            <button data-cancel="${id}">Cancel</button>
            <button data-reap="${id}">Reap</button>
            <span class="dim2" data-mstat="${id}" style="font-size:12.5px"></span>
          </div>
          <details class="txd"><summary>the exact transactions</summary>${txBox([txCancel(Number(id)), txReap(Number(id))])}</details>
        </div>`).join("")
        : `<div class="empty">This account owns none of the mandates currently open.</div>`}

      <p class="src">↳ read with <code>storage_balance_of</code>, <code>get_credit</code> and
        <code>get_mandates</code> on <b>${VAULT}</b>. All keyless — looking up an account needs
        no wallet and no permission from them.</p>`;

    for (const b of out.querySelectorAll("[data-wd]")) {
      b.onclick = () => send([txWithdraw(b.dataset.wd)],
        out.querySelector(`[data-wds="${b.dataset.wd}"]`), `the ${sym(b.dataset.wd)} withdrawal`)
        .then(() => setTimeout(lookup, 2500));
    }
    const sw = out.querySelector("#swbtn");
    if (sw) sw.onclick = () => send([txStorageWithdraw()], out.querySelector("#swstat"), "the storage withdrawal")
      .then(() => setTimeout(lookup, 2500));
    for (const b of out.querySelectorAll("[data-cancel]")) {
      b.onclick = () => send([txCancel(Number(b.dataset.cancel))],
        out.querySelector(`[data-mstat="${b.dataset.cancel}"]`), `the cancel`)
        .then(() => setTimeout(() => { loadBook(); lookup(); }, 3000));
    }
    for (const b of out.querySelectorAll("[data-reap]")) {
      b.onclick = () => send([txReap(Number(b.dataset.reap))],
        out.querySelector(`[data-mstat="${b.dataset.reap}"]`), `the reap`)
        .then(() => setTimeout(() => { loadBook(); lookup(); }, 3000));
    }
  } catch (e) {
    out.innerHTML = `<div class="verdict no">${esc(e.message)}</div>`;
  }
}

$("#yout").innerHTML = `<div class="empty">Type any account above and press <b>Look it up</b>.
  It reads the chain directly, so it needs no wallet and no permission from that account.</div>`;

$("#ago").onclick = lookup;
$("#acct").addEventListener("keydown", (e) => { if (e.key === "Enter") lookup(); });

/* ------------------------------------------------------------- section rail */

const rail = [...document.querySelectorAll(".rail a")];
const secs = rail.map((a) => document.querySelector(a.getAttribute("href")));
const spy = new IntersectionObserver((es) => {
  for (const e of es) {
    if (!e.isIntersecting) continue;
    const i = secs.indexOf(e.target);
    rail.forEach((a, j) => a.setAttribute("aria-current", String(j === i)));
  }
}, { rootMargin: "-25% 0px -65% 0px" });
secs.forEach((s) => s && spy.observe(s));

/* ------------------------------------------------------------------ go */

await loadBook();
if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
