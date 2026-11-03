import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { age, EXPLORER, short, units, VAULT, type BookEntry } from "@/lib/hallmark";
import { bookQuery, openCountQuery, tokensQuery } from "@/lib/queries";
import { meta, type TokenTable } from "@/lib/tokens";

const NS_PER_DAY = 86_400_000_000_000n;

export function BookPage() {
  const book = useQuery(bookQuery);
  const open = useQuery(openCountQuery);
  const tokens = useQuery(tokensQuery);
  const table = tokens.data ?? {};

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <header className="mb-8 space-y-3">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          The vault · live on NEAR mainnet
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">The open book</h1>
        <p className="max-w-2xl text-muted-foreground">
          Every mandate the vault currently holds, straight from <code>get_mandates</code> on{" "}
          <a className="underline" href={`${EXPLORER}/address/${VAULT}`} target="_blank" rel="noreferrer">
            {VAULT}
          </a>
          . Each one is an order with its own bound attached: the owner escrowed the input and named the
          worst all-in cost they will accept. Reading needs no wallet.
        </p>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Badge variant="outline">
            {open.isSuccess ? `${open.data} open` : open.isError ? "count unavailable" : "counting…"}
          </Badge>
          {tokens.isError && (
            <Badge variant="outline" className="text-muted-foreground">
              1Click token list unavailable — unknown tokens shown in base units
            </Badge>
          )}
          {book.dataUpdatedAt > 0 && (
            <span className="text-muted-foreground">
              read {new Date(book.dataUpdatedAt).toLocaleTimeString()}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => { void book.refetch(); void open.refetch(); }}
            disabled={book.isFetching}
          >
            <RefreshCw className={book.isFetching ? "animate-spin" : ""} />
            Refresh
          </Button>
        </div>
      </header>

      {book.isPending && (
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1].map((i) => <Skeleton key={i} className="h-80" />)}
        </div>
      )}

      {book.isError && (
        <Alert variant="destructive">
          <AlertTitle>Could not read the book</AlertTitle>
          <AlertDescription>{book.error.message}</AlertDescription>
        </Alert>
      )}

      {book.isSuccess && book.data.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            The vault holds no open mandate right now.
          </CardContent>
        </Card>
      )}

      {book.isSuccess && book.data.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {book.data.map((entry) => <MandateCard key={entry[0]} entry={entry} table={table} readAt={book.dataUpdatedAt} />)}
        </div>
      )}

      <p className="mt-8 text-xs text-muted-foreground">
        ↳ <code>get_mandates</code> reads the contract's index of open mandates only, so this costs what
        the vault holds rather than everything it has ever recorded. Refreshes every 30 s.
      </p>
    </div>
  );
}

function MandateCard({ entry: [id, m], table, readAt }: { entry: BookEntry; table: TokenTable; readAt: number }) {
  const t = m.terms;
  const inTok = meta(table, t.origin_asset);
  const outTok = meta(table, t.destination_asset);
  // measured against when the book was read, so a render never disagrees with the data it shows
  const nowNs = BigInt(readAt) * 1_000_000n;
  const leftDays = (BigInt(t.expiry_ns) - nowNs) / NS_PER_DAY;
  const expiresAt = new Date(Number(BigInt(t.expiry_ns) / 1_000_000n));
  const ceiling = t.max_cost_bps;
  const usedPct = ceiling > 0 ? Math.min(100, (m.worst_bps / ceiling) * 100) : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-3">
          <span className="font-mono text-muted-foreground">#{id}</span>
          <span>{inTok.symbol} → {outTok.symbol}</span>
          <span className="flex-1" />
          {m.open ? <Badge>open</Badge> : <Badge variant="secondary">closed</Badge>}
          {leftDays <= 0n && <Badge variant="destructive">expired</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="divide-y text-sm">
          <Row k="worst all-in cost allowed" v={<b>{ceiling} bps</b>} />
          <Row
            k="worst fill actually taken"
            v={m.fills > 0 ? (
              <span className="flex items-center gap-2">
                <span className="h-1.5 w-16 overflow-hidden rounded bg-muted">
                  <span className="block h-full bg-emerald-500" style={{ width: `${usedPct}%` }} />
                </span>
                <b>{m.worst_bps} bps</b>
                <span className="text-muted-foreground">of {ceiling}</span>
              </span>
            ) : <span className="text-muted-foreground">none yet</span>}
          />
          <Row k="escrow left" v={<Amount v={m.escrow} tok={inTok} />} />
          <Row k="biggest single fill" v={<Amount v={t.max_fill} tok={inTok} />} />
          <Row k="delivered so far" v={<Amount v={m.delivered} tok={outTok} />} />
          <Row k="fills" v={m.fills} />
          <Row k="quote must be fresher than" v={`${age(t.max_quote_age_secs)} (${t.max_quote_age_secs} s)`} />
          <Row
            k="expires"
            v={<span title={`expiry_ns ${t.expiry_ns}`}>
              {expiresAt.toISOString().replace("T", " ").slice(0, 16)} UTC
              <span className="text-muted-foreground"> · {leftDays > 0n ? `in ${leftDays} days` : "passed"}</span>
            </span>}
          />
          <Row k="owner" v={<Account id={m.owner} />} />
          <Row k="origin asset" v={<Mono>{t.origin_asset}</Mono>} />
          <Row k="destination asset" v={<Mono>{t.destination_asset}</Mono>} />
          <Row k="quote recipient" v={<Mono>{t.recipient}</Mono>} />
        </dl>
      </CardContent>
    </Card>
  );
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="shrink-0 text-muted-foreground">{k}</dt>
      <dd className="min-w-0 text-right">{v}</dd>
    </div>
  );
}

function Mono({ children }: { children: string }) {
  return <span className="block truncate font-mono text-xs" title={children}>{short(children, 18)}</span>;
}

function Account({ id }: { id: string }) {
  return (
    <a className="font-mono text-xs underline" href={`${EXPLORER}/address/${id}`} target="_blank" rel="noreferrer" title={id}>
      {short(id, 10)}
    </a>
  );
}

/** Exact base-unit formatting. If the decimals are unknown, says so rather than guessing. */
function Amount({ v, tok }: { v: string; tok: { symbol: string; dp: number | null } }) {
  if (tok.dp === null) {
    return <span title="decimals unknown">{v} <span className="text-muted-foreground">base units</span></span>;
  }
  return (
    <span title={`${v} base units`}>
      {units(v, tok.dp, 6)} <span className="text-muted-foreground">{tok.symbol}</span>
    </span>
  );
}
