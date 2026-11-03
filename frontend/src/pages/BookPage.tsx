import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { Heading, L, Source } from "@/components/doc";
import { Amount } from "@/components/fields";
import { age, short, VAULT, type BookEntry } from "@/lib/hallmark";
import { bookQuery, openCountQuery, tokensQuery } from "@/lib/queries";
import { meta, type TokenTable } from "@/lib/tokens";

const NS_PER_DAY = 86_400_000_000_000n;

/** The register of agreements in force: one ruled line per open mandate. */
export function BookPage() {
  const book = useQuery(bookQuery);
  const open = useQuery(openCountQuery);
  const tokens = useQuery(tokensQuery);
  const table = tokens.data ?? {};

  return (
    <main className="doc">
      <section className="pt-10">
        <div className="label text-faint">The register · agreements in force</div>
        <h1 className="mt-3 font-serif text-[clamp(40px,7vw,88px)] font-extrabold leading-[0.95] tracking-[-0.02em]">
          {open.isSuccess ? <><span className="hl">{open.data}</span> {open.data === 1 ? "agreement" : "agreements"} in force.</> : "The register."}
        </h1>
        <p className="mt-5 max-w-[680px] text-[19px]">
          Every mandate the vault holds right now. Each is an order with its terms attached: the owner has escrowed
          the input and named the worst all-in cost they will accept. Any filler may take one; the contract refuses
          them if the arithmetic does not hold.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <Link to="/post" className="btn btn-sign">Draw up a new one</Link>
          <button className="btn btn-sm" onClick={() => { void book.refetch(); void open.refetch(); }} disabled={book.isFetching}>
            {book.isFetching ? "reading…" : "re-read the chain"}
          </button>
          {book.dataUpdatedAt > 0 && (
            <span className="typed text-[13px] text-faint">as of {new Date(book.dataUpdatedAt).toLocaleTimeString()}</span>
          )}
        </div>
      </section>

      <Heading kicker="Schedule of agreements">In force</Heading>

      {book.isPending && <p className="typed text-faint">asking {VAULT}…</p>}
      {book.isError && <p className="typed text-seal">The register could not be read: {book.error.message}</p>}
      {book.isSuccess && book.data.length === 0 && (
        <p className="text-[19px]">
          No agreement is in force right now. <L to="/post">Draw up the first one.</L>
        </p>
      )}
      {book.isSuccess && book.data.length > 0 && <Register rows={book.data} table={table} readAt={book.dataUpdatedAt} />}

      <Source>
        get_mandates on {VAULT}, every page pinned to one block so a mandate closing mid-read cannot be skipped.
        Re-read every 30 s. {tokens.isError && "1Click's token list is unavailable, so unknown tokens show in base units."}
      </Source>
    </main>
  );
}

function Register({ rows, table, readAt }: { rows: BookEntry[]; table: TokenTable; readAt: number }) {
  const navigate = useNavigate();
  const now = BigInt(readAt) * 1_000_000n;
  return (
    <div className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
      <table className="ledger min-w-[880px]">
        <thead>
          <tr>
            <th>No.</th><th>Exchange</th><th className="text-right">Ceiling</th><th className="text-right">Worst taken</th>
            <th className="text-right">Escrow</th><th className="text-right">Fills</th><th>Fresher than</th>
            <th>Expires</th><th>Owner</th><th />
          </tr>
        </thead>
        <tbody>
          {rows.map(([id, m]) => {
            const t = m.terms;
            const inTok = meta(table, t.origin_asset);
            const outTok = meta(table, t.destination_asset);
            const days = (BigInt(t.expiry_ns) - now) / NS_PER_DAY;
            const pct = t.max_cost_bps ? Math.min(100, (m.worst_bps / t.max_cost_bps) * 100) : 0;
            return (
              <tr key={id} className="cursor-pointer" onClick={() => navigate(`/mandate/${id}`)}>
                <td className="typed font-bold">§{id}</td>
                <td className="whitespace-nowrap font-semibold">{inTok.symbol} → {outTok.symbol}</td>
                <td className="num font-bold">{t.max_cost_bps} bps</td>
                <td className="num">
                  {m.fills > 0 ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="relative inline-block h-2 w-14 border border-ink" aria-hidden>
                        <span className="absolute inset-y-0 left-0 bg-sign" style={{ width: `${pct}%` }} />
                      </span>
                      {m.worst_bps}
                    </span>
                  ) : <span className="text-faint">—</span>}
                </td>
                <td className="num"><Amount v={m.escrow} tok={inTok} /></td>
                <td className="num">{m.fills}</td>
                <td className="typed whitespace-nowrap text-[15px]">{age(t.max_quote_age_secs)}</td>
                <td className="typed whitespace-nowrap text-[15px]">{days > 0n ? `${days} days` : <span className="text-seal">expired</span>}</td>
                <td className="whitespace-nowrap"><L to={`/account/${m.owner}`} className="typed text-[14px]" onClick={(e) => e.stopPropagation()}>{short(m.owner, 6)}</L></td>
                <td className="text-right"><L to={`/mandate/${id}`} className="typed whitespace-nowrap text-[14px]" onClick={(e) => e.stopPropagation()}>price a fill →</L></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
