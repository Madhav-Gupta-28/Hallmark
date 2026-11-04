/**
 * A batch as exactly what it is — receiver, method, gas, deposit, arguments —
 * and, where asked for, the `near` CLI command that performs it.
 *
 * Both renderings come from the same `Tx` objects the wallet is handed, so the
 * command a user copies cannot drift from the transaction a button sends.
 *
 * `cli` is off inside the execution page. The page that opened it already shows
 * the command, and printing it twice made a dialog nobody could read to the
 * bottom — which is the one place every byte genuinely has to be read.
 */
import { useState, type ReactNode } from "react";
import { cliFor, near, VAULT, type Tx } from "@/lib/hallmark";

const deposit = (d: string) => (d === "1" ? "1 yoctoNEAR" : d === "0" ? "none" : `${near(d, 5)} NEAR`);

export function TxPreview({ txs, signer, cli = true }: { txs: Tx[]; signer: string | null; cli?: boolean }) {
  const cmd = cliFor(txs, signer ?? "YOUR_ACCOUNT.near");
  const acts = txs.flatMap((t, i) => t.actions.map((a) => ({ t, a, i })));

  return (
    <div className="min-w-0 space-y-6">
      {acts.map(({ t, a, i }) => (
        <div key={i}>
          <p className="label">Transaction {i + 1} of {txs.length}</p>
          <table className="ledger mt-1 text-[16px]">
            <tbody>
              <Row k="sent to" v={<>
                <code className="break-all font-bold">{t.receiverId}</code>
                {t.receiverId !== VAULT && <span className="typed text-[13px] text-faint"> ← the token contract, not the vault</span>}
              </>} />
              <Row k="calls" v={<code className="font-bold">{a.methodName}</code>} />
              <Row k="attaches" v={<span className="typed">{deposit(a.deposit)}</span>} />
              <Row k="gas" v={<span className="typed">{Number(BigInt(a.gas) / 1_000_000_000_000n)} TGas</span>} />
            </tbody>
          </table>
          <pre className="mt-2 overflow-x-auto border-2 border-ink bg-paper-2 p-3 text-[13px] leading-snug">{JSON.stringify(a.args, null, 1)}</pre>
        </div>
      ))}
      {cli && <div>
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <p className="label">Or run it yourself</p>
          <CopyButton text={cmd} />
          <span className="typed text-[12.5px] text-faint">
            the NEAR CLI signs with your own keychain — no wallet connection, no page in the middle
          </span>
        </div>
        <pre className="overflow-x-auto border-2 border-ink bg-ink p-3 text-[13px] leading-snug text-paper">{cmd}</pre>
      </div>}
    </div>
  );
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <tr>
      <td className="label w-[9rem] text-faint">{k}</td>
      <td>{v}</td>
    </tr>
  );
}

function CopyButton({ text }: { text: string }) {
  const [label, setLabel] = useState("copy");
  return (
    <button
      className="btn btn-sm"
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); setLabel("copied"); }
        catch { setLabel("select it by hand"); }
        setTimeout(() => setLabel("copy"), 1200);
      }}
    >
      {label}
    </button>
  );
}
