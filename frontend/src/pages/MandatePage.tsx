import type { ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Amount, Row } from "@/components/fields";
import { MandateCard } from "@/components/MandateCard";
import { age, fixtures, units, VAULT, type MandateRecord, type MandateTerms } from "@/lib/hallmark";
import { captureTerms, liveQuote, parseCheck, priceQuote, type Verdict } from "@/lib/price";
import { mandateQuery, tokensQuery } from "@/lib/queries";
import { meta, type TokenMeta, type TokenTable } from "@/lib/tokens";
import { cn } from "@/lib/utils";

export function MandatePage() {
  const raw = useParams().id ?? "";
  const valid = /^\d+$/.test(raw);
  const id = valid ? Number(raw) : -1;

  const mandate = useQuery({ ...mandateQuery(id), enabled: valid });
  const tokens = useQuery(tokensQuery);
  const table = tokens.data ?? {};

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <Button asChild variant="ghost" size="sm" className="mb-6 -ml-2">
        <Link to="/book"><ArrowLeft /> The open book</Link>
      </Button>

      <header className="mb-8 space-y-2">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Mandate · <code>get_mandate</code> on {VAULT}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Mandate #{raw}</h1>
      </header>

      {!valid && <Problem title="Not a mandate id">Mandate ids are whole numbers, starting at 1.</Problem>}

      {valid && mandate.isPending && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <Skeleton className="h-96" /><Skeleton className="h-96" />
        </div>
      )}

      {mandate.isError && <Problem title="Could not read the mandate">{mandate.error.message}</Problem>}

      {mandate.isSuccess && mandate.data === null && (
        <Problem title={`No mandate #${id}`}>
          The vault has no record under this id. Either it was never opened, or its owner cancelled it and
          then reaped the record to recover its storage. Ids are never reused.
        </Problem>
      )}

      {mandate.isSuccess && mandate.data && (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <MandateCard id={id} m={mandate.data} table={table} readAt={mandate.dataUpdatedAt} />
          <PricePanel id={id} m={mandate.data} table={table} />
        </div>
      )}
    </div>
  );
}

function Problem({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

/* ------------------------------------------------------------ price a fill */

function PricePanel({ id, m, table }: { id: number; m: MandateRecord; table: TokenTable }) {
  const price = useMutation({
    mutationKey: ["price", id],
    mutationFn: async (source: Source): Promise<Priced> => {
      if (source === "live") {
        const { canonical, signature } = await liveQuote(m);
        return { source, terms: m.terms, useLive: true, verdict: await priceQuote(canonical, signature, m.terms) };
      }
      // app.js's "#pfx": the worst capture, which needs nothing from the venue.
      const FX = await fixtures();
      const f = FX.worst;
      const { terms, useLive } = captureTerms(f.canonical, m);
      return { source, terms, useLive, note: f.note, verdict: await priceQuote(f.canonical, f.signature, terms) };
    },
  });
  const busy = price.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Price a fill</CardTitle>
        <CardDescription>
          Fetches a real signed quote from NEAR Intents for this mandate's pair and size, then asks the vault
          what it would do with it. The contract verifies the venue's signature, reads four signed fields, and
          answers. No oracle, no price taken on trust, nothing signed by you and nothing sent.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {!m.open && (
          <Alert>
            <AlertTitle>This mandate is closed</AlertTitle>
            <AlertDescription>
              The contract refuses every fill against a closed mandate before it checks anything else, so there
              is no live fill to price. The captured quote below still shows how the vault judges one.
            </AlertDescription>
          </Alert>
        )}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            {m.open && (
              <Button onClick={() => price.mutate("live")} disabled={busy}>
                {busy && price.variables === "live" ? "Asking the venue, then the vault…" : "Get a live quote"}
              </Button>
            )}
            <Button variant="outline" onClick={() => price.mutate("capture")} disabled={busy}>
              {busy && price.variables === "capture" ? "Replaying the capture…" : "Use the malicious capture instead"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            ↳ the second button needs nothing from the venue — it replays a genuinely signed capture carrying a
            500 bps hidden fee, so you can see a refusal even if 1Click is down.
          </p>
          {price.isSuccess && (
            <p className="text-xs text-muted-foreground">
              answered {new Date(price.submittedAt).toLocaleTimeString()}
              {price.data.source === "live" && <> · a quote ages out of this mandate after {age(m.terms.max_quote_age_secs)}</>}
            </p>
          )}
        </div>

        {price.isError && (
          <Problem title="No verdict">
            {price.error.message}. Nothing was signed and nothing moved.
            {price.variables === "live" && " Try the captured quote instead — it needs no venue."}
          </Problem>
        )}

        {price.isSuccess && price.data.source === "capture" && <CaptureBanner p={price.data} id={id} />}
        {price.isSuccess && (
          <VerdictView
            mandateId={price.data.useLive ? id : null}
            r={price.data.verdict}
            terms={price.data.terms}
            table={table}
          />
        )}

        {price.isIdle && m.open && (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            Nothing has been asked of the chain yet. The answer fills in with the venue's signature, the signed
            numbers, both cost figures, and the contract's own verdict at two delivery sizes — each a keyless
            view call you can repeat yourself.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function VerdictView({ mandateId, r, terms: t, table }: {
  mandateId: number | null; r: Verdict; terms: MandateTerms; table: TokenTable;
}) {
  const inTok = meta(table, t.origin_asset);
  const outTok = meta(table, t.destination_asset);
  const ceil = t.max_cost_bps;
  const stale = r.ageSecs > t.max_quote_age_secs;
  const scale = Math.max(ceil, r.worstBps, 1);

  const floor = parseCheck(r.atFloor);
  const full = parseCheck(r.atFull);

  return (
    <div className="space-y-5">
      <dl className="divide-y text-sm">
        <Row k="signed by NEAR Intents?" v={r.signed
          ? <Good>yes — valid ed25519 over these exact bytes</Good>
          : <Bad>NO — these are not the bytes the venue signed</Bad>} />
        <Row k="unsigned field inside the signed bytes?" v={r.leaked.length ? <Bad>{r.leaked.join(", ")}</Bad> : <Good>none</Good>} />
        <Row k="in" v={<>${Number(r.q.amountInUsd).toFixed(4)} · <Amount v={r.q.amountIn} tok={inTok} /></>} />
        <Row k="out, if honoured in full" v={<>${Number(r.q.amountOutUsd).toFixed(4)} · <Amount v={r.q.amountOut} tok={outTok} /></>} />
        <Row k="out, guaranteed floor" v={<Amount v={r.q.minAmountOut} tok={outTok} />} />
        <Row
          k={<>signed at <span className="text-xs">← by the venue, inside the signature</span></>}
          v={<>{r.q.timestamp} {stale ? <Bad>{age(r.ageSecs)} ago</Bad> : <Good>{age(r.ageSecs)} ago</Good>}</>}
        />
        <Row
          k={<>deadline <span className="text-xs">← chosen by whoever asked</span></>}
          v={<span className="text-muted-foreground">{r.q.deadline}</span>}
        />
        <Row k="size against this mandate's cap" v={r.fillable
          ? <Good>within {capText(t.max_fill, inTok)}</Good>
          : <Bad>over the {capText(t.max_fill, inTok)} cap</Bad>} />
        <Row k="cost if honoured in full" v={<span className={cn("text-xl font-semibold", r.fullBps > ceil && "text-destructive")}>{r.fullBps} bps</span>} />
        <Row k="guaranteed-worst all-in cost" v={<span className={cn("text-xl font-semibold", r.worstBps > ceil ? "text-destructive" : "text-emerald-600")}>{r.worstBps} bps</span>} />
      </dl>

      <div className="relative h-8 overflow-hidden rounded-md bg-muted text-xs">
        <div className={cn("absolute inset-y-0 left-0", r.worstBps > ceil ? "bg-destructive/30" : "bg-emerald-500/30")}
          style={{ width: `${Math.min(100, (r.worstBps / scale) * 100)}%` }} />
        <div className="absolute inset-y-0 w-0.5 bg-foreground" style={{ left: `${Math.min(100, (ceil / scale) * 100)}%` }} />
        <div className="relative flex h-full items-center px-3">
          <b>{r.worstBps} bps</b>&nbsp;guaranteed worst · ceiling&nbsp;<b>{ceil} bps</b>
        </div>
      </div>

      {/* Both deliveries, side by side. web/app.js's Fill button sends minAmountOut, which is
          refused whenever the floor alone breaches the ceiling even though a full delivery
          passes — so the floor verdict is the one a naive filler would actually get. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <CheckBox
          title="Delivering the signed floor"
          sub="minAmountOut — the least the venue guaranteed"
          delivered={<Amount v={r.q.minAmountOut} tok={outTok} />}
          raw={r.atFloor} parsed={floor} inTok={inTok}
        />
        <CheckBox
          title="Delivering the full quote"
          sub="amountOut — the expected fill"
          delivered={<Amount v={r.q.amountOut} tok={outTok} />}
          raw={r.atFull} parsed={full} inTok={inTok}
        />
      </div>

      {full.allowed && !floor.allowed && (
        <Alert>
          <AlertTitle>A filler has to deliver more than the floor here</AlertTitle>
          <AlertDescription>
            The contract checks the cost on what actually arrives. Delivering the full quote passes; delivering
            only the venue's guaranteed floor would be refused and the tokens returned. A filler that sends{" "}
            <code>minAmountOut</code> by default would fail on this quote.
          </AlertDescription>
        </Alert>
      )}
      {!full.allowed && (
        <Alert variant="destructive">
          <AlertTitle>No fill against this quote passes</AlertTitle>
          <AlertDescription>
            Even a delivery of the full quote is refused, so no filler can use this quote on this mandate.
          </AlertDescription>
        </Alert>
      )}

      <p className="text-xs text-muted-foreground">
        ↳ every figure above was answered by <b>{VAULT}</b> on NEAR mainnet against{" "}
        {mandateId !== null ? <>mandate #{mandateId}'s real terms</> : <>the illustrative terms shown</>} — a{" "}
        {ceil} bps ceiling and a {t.max_quote_age_secs} s freshness bound. The quote is a{" "}
        <code>dry: true</code> quote; it commits nobody to anything.
      </p>
    </div>
  );
}

function CheckBox({ title, sub, delivered, raw, parsed, inTok }: {
  title: string; sub: string; delivered: ReactNode; raw: string; parsed: ReturnType<typeof parseCheck>; inTok: TokenMeta;
}) {
  return (
    <div className={cn("space-y-2 rounded-md border p-3 text-sm",
      parsed.allowed ? "border-emerald-500/50 bg-emerald-500/5" : "border-destructive/50 bg-destructive/5")}>
      <div className="flex items-center justify-between gap-2">
        <b>{title}</b>
        {parsed.allowed ? <Badge className="bg-emerald-600">allowed</Badge> : <Badge variant="destructive">refused</Badge>}
      </div>
      <p className="text-xs text-muted-foreground">{sub}: {delivered}</p>
      {parsed.allowed ? (
        <p>
          <b>{parsed.costBps} bps</b> realised cost · filler earns{" "}
          {parsed.earns && <Amount v={parsed.earns} tok={inTok} />}
        </p>
      ) : (
        parsed.reason && <p><b>{parsed.reason}</b></p>
      )}
      <code className="block break-all text-xs text-muted-foreground" title="dry_check, verbatim">{raw}</code>
    </div>
  );
}

const capText = (v: string, tok: TokenMeta) => (tok.dp === null ? `${v} base units` : `${units(v, tok.dp, 6)} ${tok.symbol}`);
const Good = ({ children }: { children: ReactNode }) => <span className="text-emerald-600">{children}</span>;
const Bad = ({ children }: { children: ReactNode }) => <span className="font-medium text-destructive">{children}</span>;

/* ------------------------------------------------------------- the capture */

type Source = "live" | "capture";

interface Priced {
  source: Source;
  /** the terms the verdict was asked against */
  terms: MandateTerms;
  /** true when those are this mandate's real terms */
  useLive: boolean;
  note?: string;
  verdict: Verdict;
}

/**
 * What the capture is, and, unlike app.js's banner, which check actually
 * refused it. The capture is days old, so against a 300 s age bound the vault
 * refuses it as `QuoteTooOld` before the cost check runs; after its signed
 * deadline (2026-11-20) it is `QuoteExpired` first. The hidden fee is still
 * priced by `worst_cost` and `realised_cost`, which do not check freshness.
 */
function CaptureBanner({ p, id }: { p: Priced; id: number }) {
  const r = p.verdict;
  const reason = parseCheck(r.atFull).reason ?? parseCheck(r.atFloor).reason;
  const ceil = p.terms.max_cost_bps;
  return (
    <Alert>
      <AlertTitle>A captured quote carrying a 500 bps hidden fee</AlertTitle>
      <AlertDescription className="space-y-2">
        <p>
          {p.note} It is genuinely signed by NEAR Intents — the signature below verifies. The fee lives in{" "}
          <code>appFees</code>, which the venue does not sign, so the contract never reads that field. It does not
          need to: the cost is already inside the signed numbers — <b>{r.worstBps} bps</b> guaranteed-worst
          and <b>{r.fullBps} bps</b> even if honoured in full, against a {ceil} bps ceiling.
        </p>
        <p>
          {p.useLive
            ? <>Priced against live mandate #{id}'s real terms.</>
            : <>Mandate #{id} trades a different pair, so this is priced against illustrative terms for the
              capture's own pair: a {ceil} bps ceiling and a {p.terms.max_quote_age_secs} s age bound.</>}
        </p>
        {reason === "QuoteTooOld" && (
          <p>
            <b>Refused first by the age bound, not the fee.</b> The capture was signed {age(r.ageSecs)} ago, and
            these terms accept quotes up to {age(p.terms.max_quote_age_secs)} old. The vault checks freshness
            before cost, so <code>QuoteTooOld</code> is the reason it gives; the cost figures show the fee would
            breach the ceiling too.
          </p>
        )}
        {reason === "QuoteExpired" && (
          <p>
            <b>Refused first because the quote's own deadline ({r.q.deadline}) has passed</b> — the vault checks
            that before freshness or cost. The cost figures still show the fee.
          </p>
        )}
      </AlertDescription>
    </Alert>
  );
}
