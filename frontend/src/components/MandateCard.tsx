import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Account, Amount, Mono, Row } from "@/components/fields";
import { age, type MandateRecord } from "@/lib/hallmark";
import { meta, type TokenTable } from "@/lib/tokens";

const NS_PER_DAY = 86_400_000_000_000n;

interface Props {
  id: number;
  m: MandateRecord;
  table: TokenTable;
  /** ms epoch the record was read at; expiry is measured against this, not render time */
  readAt: number;
  /** show the link to /mandate/:id (the book does; the mandate page itself does not) */
  link?: boolean;
}

export function MandateCard({ id, m, table, readAt, link = false }: Props) {
  const t = m.terms;
  const inTok = meta(table, t.origin_asset);
  const outTok = meta(table, t.destination_asset);
  const nowNs = BigInt(readAt) * 1_000_000n;
  const leftDays = (BigInt(t.expiry_ns) - nowNs) / NS_PER_DAY;
  const expiresAt = new Date(Number(BigInt(t.expiry_ns) / 1_000_000n));
  const ceiling = t.max_cost_bps;
  const usedPct = ceiling > 0 ? Math.min(100, (m.worst_bps / ceiling) * 100) : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-3">
          {link
            ? <Link to={`/mandate/${id}`} className="font-mono text-muted-foreground hover:underline">#{id}</Link>
            : <span className="font-mono text-muted-foreground">#{id}</span>}
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
      {link && (
        <CardFooter>
          <Button asChild variant="outline" size="sm">
            <Link to={`/mandate/${id}`}>Price a fill against #{id} →</Link>
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
