/**
 * Talking to the vault.
 *
 * Every read is a plain JSON-RPC view call: no key, no account, no library. The
 * writes need a key, and go through near-api-js.
 */
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner } from "near-api-js";

export interface MandateTerms {
  origin_asset: string;
  destination_asset: string;
  recipient: string;
  max_cost_bps: number;
  /** origin base units, as a string: u128 does not fit a JS number */
  max_fill: string;
  /**
   * How stale a quote may be at fill time, measured from the venue's own signed
   * `timestamp`. Without it the cost ceiling is enforced against USD marks of
   * unbounded age — see ARCHITECTURE.md §2.10.
   */
  max_quote_age_secs: number;
  /** nanoseconds, as a string: u64 does not fit a JS number either */
  expiry_ns: string;
}

export interface MandateRecord {
  owner: string;
  terms: MandateTerms;
  escrow: string;
  delivered: string;
  fills: number;
  worst_bps: number;
  open: boolean;
}

const GAS = 100_000_000_000_000n; // 100 TGas; a fill measures 7.8 (§5.7)

export class Hallmark {
  constructor(
    readonly vault: string,
    readonly rpc = "https://rpc.mainnet.near.org",
  ) {}

  /** A keyless view call. This is how a filler reads the order book. */
  async view<T>(method: string, args: unknown = {}): Promise<T> {
    const res = await fetch(this.rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "query",
        params: {
          request_type: "call_function",
          finality: "final",
          account_id: this.vault,
          method_name: method,
          args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
        },
      }),
    });
    const body = await res.json();
    if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error).slice(0, 300)}`);
    if (body.result?.error) {
      if (String(body.result.error).includes("CodeDoesNotExist")) {
        throw new Error(
          `no Hallmark vault deployed at ${this.vault} on ${this.rpc}.\n` +
            `  Set HALLMARK_VAULT to a deployed vault, or deploy one — see DEPLOY.md`,
        );
      }
      throw new Error(`${method}: ${body.result.error}`);
    }
    return JSON.parse(Buffer.from(body.result.result).toString());
  }

  openMandates(): Promise<[number, MandateRecord][]> {
    return this.view("get_mandates", {});
  }

  mandate(id: number): Promise<MandateRecord | null> {
    return this.view("get_mandate", { mandate_id: id });
  }

  credit(accountId: string, asset: string): Promise<string> {
    return this.view("get_credit", { account_id: accountId, asset });
  }

  /** What the bound says, computed by the contract rather than by us. */
  worstCost(canonical: string): Promise<number> {
    return this.view("worst_cost", { canonical });
  }

  /** How old the venue's signature on this quote is, as the chain sees it. */
  quoteAgeSecs(canonical: string): Promise<string> {
    return this.view("quote_age_secs", { canonical });
  }

  /** What `open` will charge the owner in storage staking, in yoctoNEAR. */
  storageCostEstimate(): Promise<string> {
    return this.view("storage_cost_estimate", {});
  }

  storageBalanceOf(accountId: string): Promise<string> {
    return this.view("storage_balance_of", { account_id: accountId });
  }

  dryCheck(
    canonical: string,
    signature: string,
    terms: MandateTerms,
    delivered: string,
  ): Promise<string> {
    return this.view("dry_check", { canonical, signature, terms, delivered });
  }
}

export function signer(accountId: string, privateKey: string, rpc: string): Account {
  const provider = new JsonRpcProvider({ url: rpc });
  const keyPair = KeyPair.fromString(privateKey as `ed25519:${string}`);
  return new Account(accountId, provider, new KeyPairSigner(keyPair));
}

/**
 * Send tokens to the vault with an action attached. This single call shape does
 * everything that moves value: opening a mandate, funding one, and filling one
 * (ARCHITECTURE.md §4).
 */
export async function transferCall(
  account: Account,
  token: string,
  vault: string,
  amount: string,
  action: unknown,
) {
  return account.callFunctionRaw({
    contractId: token,
    methodName: "ft_transfer_call",
    args: { receiver_id: vault, amount, msg: JSON.stringify(action) },
    gas: GAS,
    deposit: 1n,
  });
}

/** `nep141:wrap.near` -> `wrap.near` */
export const tokenAccount = (asset: string) => asset.replace(/^nep141:/, "");
