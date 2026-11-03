import { A, L, Signature } from "@/components/doc";
import { EXPLORER, VAULT } from "@/lib/hallmark";

/**
 * Every page ends where a contract does: with who answers for it. The third
 * line is honest about the upgrade key — the contract has no admin function,
 * but the account still holds a full-access key (README "Status", limits).
 */
export function Footer() {
  return (
    <footer className="doc mb-16 mt-24">
      <div className="double-rule mb-10" />
      <div className="flex flex-col gap-10 sm:flex-row sm:gap-8">
        <Signature name="the owner" role="Names the worst cost, escrows the input" />
        <Signature name={VAULT} role="Enforces every clause, on NEAR mainnet" />
        <Signature name="nobody" role={<>Counter-signed by no admin function — <L to="/limits">see the upgrade key</L></>} />
      </div>
      <p className="typed mt-10 text-[12.5px] leading-relaxed text-faint">
        Every figure in this register is a keyless view call to{" "}
        <A href={`${EXPLORER}/address/${VAULT}`}>{VAULT}</A>. Nothing here is computed by a server, because there
        is no server. MIT licence ·{" "}
        <A href="https://github.com/Madhav-Gupta-28/Hallmark">source</A>
      </p>
    </footer>
  );
}
