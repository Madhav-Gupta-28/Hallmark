/**
 * Whatever came back from a wallet — a redirect wallet's return or an in-page
 * hashes — and what each transaction actually did, read from the chain.
 *
 * A redirect wallet returns with a full page load and the result in the URL, so
 * `useSigned` reads it once, purely, at mount; Meteor resolves in place and
 * the page hands its hashes to `setSigned`. The wallet's parameters are then
 * removed from the URL so a reload does not replay them, and the pending
 * record is cleared only once it is held in state (StrictMode runs effects
 * twice; a read-and-clear in one step would lose the signer).
 */
import { useEffect, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { A, L, Seal, Stamp } from "@/components/doc";
import { EXPLORER, forgetCache, near, short } from "@/lib/hallmark";
import {
  clearPending, interpret, readCallback, txOutcome, withoutCallback,
  type Interpreted,
} from "@/lib/redirect";
import type { Signed } from "@/lib/signed";
import { useWallet } from "@/wallet/context";

export function SigningResult({ signed }: { signed: Signed }) {
  const navigate = useNavigate();
  const w = useWallet();
  const qc = useQueryClient();

  useEffect(() => {
    clearPending();
    if (readCallback(location.search)) navigate(withoutCallback(location.href), { replace: true });
  }, [signed, navigate]);

  const signer = signed.pending?.signer ?? w.accountId;
  const hashes = signed.cb.kind === "signed" ? signed.cb.hashes : [];
  const outcomes = useQueries({
    queries: hashes.map((h) => ({
      queryKey: ["tx", h, signer],
      queryFn: async () => interpret(await txOutcome(h, signer!)),
      enabled: !!signer,
      staleTime: Infinity,
      retry: false,
    })),
  });

  // Something changed on chain: drop every cached read of the vault and the account.
  const anyOk = outcomes.some((o) => o.data?.ok);
  useEffect(() => {
    if (!anyOk) return;
    forgetCache();
    void qc.invalidateQueries({ queryKey: ["vault"] });
    void qc.invalidateQueries({ queryKey: ["account"] });
  }, [anyOk, qc]);

  if (signed.cb.kind === "error") {
    return (
      <section className="mb-10 mt-8 flex flex-wrap items-center gap-6 border-y-[6px] border-double border-ink py-6">
        <Seal slam top="not signed" big="✗" bottom="nothing sent" size={120} tilt={-10} />
        <div>
          <p className="label text-faint">Record of execution</p>
          <p className="mt-1 text-[20px]"><b>The wallet did not sign.</b> {signed.cb.message || signed.cb.code}{" "}
            <span className="typed text-[13px] text-faint">({signed.cb.code})</span></p>
          <p className="text-[17px]">Nothing was sent, and nothing moved.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="mb-10 mt-8 border-y-[6px] border-double border-ink py-6">
      <p className="label text-faint">Record of execution</p>
      <h2 className="mt-1 font-serif text-[clamp(26px,3.6vw,38px)] font-extrabold leading-tight">What happened on chain</h2>
      <p className="mt-2 max-w-[760px] text-[17px]">
        Read from each transaction's final outcome{signer ? <> as sent by <b className="typed">{signer}</b></> : null} —
        not taken on the wallet's word. A transfer can succeed while the vault refuses it; the token then refunds it.
      </p>
      {!signer && <p className="typed mt-3 text-[14px] text-faint">Connect the signing account to read the outcomes.</p>}
      <table className="ledger mt-5">
        <tbody>
          {hashes.map((h, i) => {
            const o = outcomes[i];
            return (
              <tr key={h}>
                <td className="w-[11rem]"><A href={`${EXPLORER}/txns/${h}`} className="typed text-[14px]">{short(h, 8)}</A></td>
                <td>
                  {o.isPending && signer && <span className="typed text-[14px] text-faint">waiting for finality…</span>}
                  {o.isError && <span className="typed text-[14px] text-seal">could not read it: {o.error.message}</span>}
                  {o.data && <OutcomeLine r={o.data} />}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

const Ok = ({ children }: { children: string }) => <Stamp ink="blue">{children}</Stamp>;
const No = ({ children }: { children: string }) => <Stamp>{children}</Stamp>;
const Then = ({ children }: { children: ReactNode }) => <span className="ml-3 text-[17px]">{children}</span>;

function OutcomeLine({ r }: { r: Interpreted }) {
  switch (r.kind) {
    case "storage_deposit":
      return <><Ok>storage prepaid</Ok><Then>your prepaid balance is now {near(r.credited, 5)} NEAR.</Then></>;
    case "open":
      return r.ok
        ? <><Ok>agreement in force</Ok><Then><L to={`/mandate/${r.mandateId}`}>Agreement §{r.mandateId} →</L></Then></>
        : <><No>not opened</No><Then>{r.reason}. The token refunded the transfer.</Then></>;
    case "fund":
      return r.ok
        ? <><Ok>escrow topped up</Ok><Then><L to={`/mandate/${r.mandateId}`}>Agreement §{r.mandateId} →</L></Then></>
        : <><No>not topped up</No><Then>{r.reason}. The token refunded the transfer.</Then></>;
    case "withdraw":
    case "storage_withdraw":
      return r.ok
        ? <Ok>{r.kind === "withdraw" ? "paid out" : "storage paid out"}</Ok>
        : <><No>not paid out</No><Then>{r.reason}</Then></>;
    case "cancel":
      return <><Ok>agreement closed</Ok><Then>§{r.mandateId}; its unspent escrow is now a credit you can withdraw.</Then></>;
    case "reap":
      return <><Ok>record reaped</Ok><Then>{near(r.refunded, 5)} NEAR of storage returned to your prepaid balance.</Then></>;
    default:
      return r.ok ? <Ok>succeeded</Ok> : <><No>failed</No><Then>{r.reason}</Then></>;
  }
}
