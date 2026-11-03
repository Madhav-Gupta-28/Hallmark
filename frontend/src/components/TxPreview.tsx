/**
 * A batch as exactly what it is — receiver, method, gas, deposit, arguments —
 * plus the `near` CLI command that performs it. The reference's `txBox`.
 *
 * Both renderings come from the same `Tx` objects the wallet is handed, so the
 * command a user copies cannot drift from the transaction a button sends.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cliFor, near, VAULT, type Tx } from "@/lib/hallmark";

const deposit = (d: string) => (d === "1" ? "1 yoctoNEAR" : d === "0" ? "0" : `${near(d, 5)} NEAR`);

export function TxPreview({ txs, signer }: { txs: Tx[]; signer: string | null }) {
  const cmd = cliFor(txs, signer ?? "YOUR_ACCOUNT.near");
  const acts = txs.flatMap((t, i) => t.actions.map((a) => ({ t, a, i })));

  return (
    <div className="space-y-3 text-sm">
      {acts.map(({ t, a, i }) => (
        <div key={i} className="rounded-md border p-3">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Transaction {i + 1} of {txs.length}
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-muted-foreground">receiver</dt>
            <dd>
              <code>{t.receiverId}</code>
              {t.receiverId !== VAULT && <span className="text-muted-foreground"> ← the token, not the vault</span>}
            </dd>
            <dt className="text-muted-foreground">method</dt>
            <dd><code>{a.methodName}</code></dd>
            <dt className="text-muted-foreground">gas</dt>
            <dd>{Number(BigInt(a.gas) / 1_000_000_000_000n)} TGas</dd>
            <dt className="text-muted-foreground">deposit</dt>
            <dd>{deposit(a.deposit)}</dd>
          </dl>
          <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 text-xs">{JSON.stringify(a.args, null, 1)}</pre>
        </div>
      ))}
      <div>
        <div className="mb-1 flex items-center gap-3">
          <CopyButton text={cmd} />
          <span className="text-xs text-muted-foreground">
            the same {txs.length === 1 ? "transaction" : `${txs.length} transactions`} with the NEAR CLI · signs with
            your keychain, never with this page
          </span>
        </div>
        <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">{cmd}</pre>
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [label, setLabel] = useState("copy command");
  return (
    <Button
      variant="outline" size="sm"
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); setLabel("copied"); }
        catch { setLabel("select it manually"); }
        setTimeout(() => setLabel("copy command"), 1200);
      }}
    >
      {label}
    </Button>
  );
}
