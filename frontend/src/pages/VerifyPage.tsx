import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Entry, Heading, L, Seal, Source, Stamp } from "@/components/doc";
import { Amount } from "@/components/fields";
import { age, fixtures, getQuote, VAULT } from "@/lib/hallmark";
import { parseCheck, priceQuote, refusalOf } from "@/lib/price";
import { tokensQuery } from "@/lib/queries";
import { meta } from "@/lib/tokens";
import { cn } from "@/lib/utils";
import { parseSubmission, termsFor } from "@/lib/verify";

/** 1Click's USDC on NEAR — the asset of the captured fixtures, so a fresh quote is comparable. */
const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

export function VerifyPage() {
  const tokens = useQuery(tokensQuery);
  const table = tokens.data ?? {};
  const [text, setText] = useState("");
  const [sig, setSig] = useState("");
  const [bps, setBps] = useState("300");
  const [ageS, setAgeS] = useState("300");
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  const ceiling = Number(bps), maxAge = Number(ageS);
  const boundsOk = Number.isInteger(ceiling) && ceiling >= 1 && ceiling <= 10000 && Number.isInteger(maxAge) && maxAge >= 1 && maxAge <= 2_592_000;

  const certify = useMutation({
    mutationKey: ["verify"],
    mutationFn: async () => {
      const s = parseSubmission(text, sig);
      const terms = termsFor(s.canonical, ceiling, maxAge);
      return { s, terms, r: await priceQuote(s.canonical, s.signature, terms) };
    },
  });

  const load = async (what: "worst" | "honest" | "fresh") => {
    setLoadErr(null); setLoading(what); certify.reset();
    try {
      if (what === "fresh") {
        const res = await getQuote({ originAsset: USDC, destinationAsset: "nep141:wrap.near", amount: "10000000", recipient: VAULT });
        setText(JSON.stringify(res, null, 1)); setSig("");
      } else {
        const f = (await fixtures())[what];
        setText(JSON.stringify({ canonical: f.canonical, signature: f.signature }, null, 1)); setSig("");
      }
    } catch (e) { setLoadErr((e as Error).message); }
    finally { setLoading(null); }
  };

  return (
    <main className="doc">
      <section className="pt-10">
        <div className="label text-faint">Certificate of verification · no wallet, no agreement needed</div>
        <h1 className="mt-3 font-serif text-[clamp(40px,7vw,88px)] font-extrabold leading-[0.95] tracking-[-0.02em]">
          Is this quote <span className="hl">what it says?</span>
        </h1>
        <p className="mt-5 max-w-[720px] text-[19px]">
          Paste any NEAR Intents quote. The contract at <code>{VAULT}</code> checks the venue's own signature over the
          exact bytes, reads the four signed numbers, and says what the quote really guarantees — and whether a fill
          against it would be honoured under terms you choose. Everything is a free view call.
        </p>
      </section>

      <Heading kicker="Exhibit">The quote</Heading>
      <div className="mb-4 flex flex-wrap gap-3">
        <button className="btn btn-sm" onClick={() => void load("worst")} disabled={loading !== null}>{loading === "worst" ? "loading…" : "Exhibit A — the 99.99% loss"}</button>
        <button className="btn btn-sm" onClick={() => void load("honest")} disabled={loading !== null}>{loading === "honest" ? "loading…" : "an honest capture"}</button>
        <button className="btn btn-sm btn-ink" onClick={() => void load("fresh")} disabled={loading !== null}>{loading === "fresh" ? "asking 1Click…" : "fetch a fresh one: $10 → wNEAR"}</button>
      </div>
      {loadErr && <p className="typed mb-3 text-[14px] text-seal">{loadErr}</p>}
      <textarea
        className="block min-h-[220px] w-full resize-y border-2 border-ink bg-paper-2 p-4 font-mono text-[13px] leading-snug outline-none focus:bg-paper"
        placeholder={'{ "quote": { … }, "quoteRequest": { … }, "signature": "ed25519:…", "timestamp": "…" }'}
        value={text} onChange={(e) => { setText(e.target.value); certify.reset(); }} spellCheck={false}
        aria-label="quote JSON"
      />
      <p className="mt-4 text-[18px]">
        Signature, if it is not in the JSON above:{" "}
        <input className="blank" style={{ width: "min(46ch, 70vw)" }} value={sig} placeholder="ed25519:…"
          onChange={(e) => { setSig(e.target.value); certify.reset(); }} spellCheck={false} aria-label="signature" />
      </p>

      <div className="mt-6 text-[clamp(18px,2vw,21px)] leading-[2]">
        Rule on it as if the owner would pay no more than{" "}
        <input className="blank" style={{ width: "6ch" }} inputMode="numeric" value={bps} aria-label="ceiling bps"
          aria-invalid={!(Number.isInteger(ceiling) && ceiling >= 1 && ceiling <= 10000)} onChange={(e) => { setBps(e.target.value); certify.reset(); }} />{" "}
        bps, and refused quotes older than{" "}
        <input className="blank" style={{ width: "8ch" }} inputMode="numeric" value={ageS} aria-label="max quote age"
          aria-invalid={!(Number.isInteger(maxAge) && maxAge >= 1 && maxAge <= 2_592_000)} onChange={(e) => { setAgeS(e.target.value); certify.reset(); }} />{" "}
        seconds <span className="typed text-[0.7em] text-faint">(the contract allows up to 2,592,000 — 30 days)</span>.
      </div>

      <div className="mt-6">
        <button className="btn btn-sign" disabled={!text.trim() || !boundsOk || certify.isPending} onClick={() => certify.mutate()}>
          {certify.isPending ? `asking ${VAULT}…` : "Certify"}
        </button>
      </div>

      {certify.isError && (
        <div className="mt-8 flex items-center gap-4"><Stamp>not certified</Stamp><p className="text-[18px]">{certify.error.message}</p></div>
      )}

      {certify.isSuccess && (() => {
        const { r, terms } = certify.data;
        const inTok = meta(table, terms.origin_asset);
        const outTok = meta(table, terms.destination_asset);
        const floor = parseCheck(r.atFloor), full = parseCheck(r.atFull);
        return (
          <section className="mt-10">
            <Heading kicker="Certificate">Findings of {VAULT}</Heading>
            <div className="grid gap-12 lg:grid-cols-[1.3fr_1fr]">
              <div>
                <Entry k="Signed by NEAR Intents over these exact bytes?" v={r.signed ? <Stamp ink="blue">genuine</Stamp> : <Stamp>not signed by the venue</Stamp>} />
                <Entry k="Unsigned field inside the signed bytes?" v={r.leaked.length ? <Stamp>{r.leaked.join(", ")}</Stamp> : <span className="text-sign">none</span>} />
                <Entry k="Exchange" v={<span className="typed">{inTok.symbol} → {outTok.symbol}</span>} />
                <Entry k="In" v={<span className="typed">${Number(r.q.amountInUsd).toFixed(4)} · <Amount v={r.q.amountIn} tok={inTok} /></span>} />
                <Entry k="Out, as advertised" v={<span className="typed">${Number(r.q.amountOutUsd).toFixed(4)} · <Amount v={r.q.amountOut} tok={outTok} /></span>} />
                <Entry k="Out, actually guaranteed" v={<span className="typed"><Amount v={r.q.minAmountOut} tok={outTok} /></span>} />
                <Entry k="Signed at" v={<span className="typed">{r.q.timestamp} · <span className={r.ageSecs > maxAge ? "text-seal" : "text-sign"}>{age(r.ageSecs)} ago</span></span>} />
                <Entry k="Cost if honoured in full" v={<b className={cn("typed text-[22px]", r.fullBps > ceiling ? "text-seal" : "text-sign")}>{r.fullBps} bps</b>} />
                <Entry k="Guaranteed-worst cost" v={<b className={cn("typed text-[22px]", r.worstBps > ceiling ? "text-seal" : "text-sign")}>{r.worstBps} bps</b>} />
              </div>
              <div className="space-y-6">
                {[["At the guaranteed floor", floor, r.atFloor], ["At the advertised amount", full, r.atFull]].map(([title, c, raw]) => {
                  const pc = c as ReturnType<typeof parseCheck>;
                  const why = refusalOf(pc.reason);
                  return (
                    <div key={title as string} className="flex items-center gap-5">
                      {pc.allowed
                        ? <Seal slam ink="blue" top="would honour" big={`${pc.costBps}`} bottom="bps" size={132} tilt={-8} />
                        : <Seal slam top="would refuse" big={why.clause} bottom={why.words} size={132} tilt={-8} />}
                      <div className="min-w-0">
                        <p className="font-bold">{title as string}</p>
                        <code className={cn("block break-all text-[12px]", pc.allowed ? "text-sign" : "text-seal")}>{raw as string}</code>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <Source>
              is_signed · worst_cost · realised_cost · quote_age_secs · dry_check ×2 on {VAULT}, against a {ceiling} bps
              ceiling and a {maxAge} s age bound. To hold a real order to terms like these, <L to="/post">draw up an agreement</L>.
            </Source>
          </section>
        );
      })()}
    </main>
  );
}
