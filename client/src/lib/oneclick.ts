/**
 * The 1Click API, as much of it as Hallmark needs.
 *
 * `POST /v0/quote` is public with both `dry: true` and `dry: false` — no JWT,
 * no partner agreement. That is what makes a permissionless venue possible, and
 * it is verified in ARCHITECTURE.md §3.4. The one trap: a request without a
 * `User-Agent` is answered with HTTP 403, which reads like an auth failure and
 * is not.
 */
export const ONECLICK = "https://1click.chaindefuser.com";

export interface QuoteParams {
  originAsset: string;
  destinationAsset: string;
  amount: string;
  recipient: string;
  refundTo: string;
  /** bps. Lower means the venue commits to a tighter floor. */
  slippageTolerance?: number;
  deadline?: string;
  dry?: boolean;
  depositType?: "ORIGIN_CHAIN" | "INTENTS";
  recipientType?: "DESTINATION_CHAIN" | "INTENTS";
  refundType?: "ORIGIN_CHAIN" | "INTENTS";
}

async function call(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${ONECLICK}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Without this the host answers 403, which is not an auth error (§3.4).
      "User-Agent": "hallmark/0.1",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`1Click ${path} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

/** A signed quote. `dry: true` costs nothing and commits nothing. */
export async function getQuote(p: QuoteParams) {
  return call("/v0/quote", {
    dry: p.dry ?? true,
    swapType: "EXACT_INPUT",
    slippageTolerance: p.slippageTolerance ?? 100,
    originAsset: p.originAsset,
    depositType: p.depositType ?? "ORIGIN_CHAIN",
    destinationAsset: p.destinationAsset,
    amount: p.amount,
    refundTo: p.refundTo,
    refundType: p.refundType ?? "ORIGIN_CHAIN",
    recipient: p.recipient,
    recipientType: p.recipientType ?? "DESTINATION_CHAIN",
    deadline: p.deadline ?? new Date(Date.now() + 36e5).toISOString(),
  });
}

export interface TokenInfo {
  assetId: string;
  symbol: string;
  decimals: number;
  blockchain: string;
  price?: number;
}

export async function getTokens(): Promise<TokenInfo[]> {
  const res = await fetch(`${ONECLICK}/v0/tokens`, { headers: { "User-Agent": "hallmark/0.1" } });
  if (!res.ok) throw new Error(`1Click /v0/tokens -> HTTP ${res.status}`);
  return res.json();
}

/**
 * Resolve a ticker to the asset settling on NEAR, which is what a vault can
 * hold. `NEAR` is accepted as an alias for `wNEAR`, since that is what anyone
 * types. Of 210 listed assets, 34 settle on NEAR.
 */
export async function nearAsset(symbol: string): Promise<TokenInfo> {
  const want = symbol.toLowerCase() === "near" ? "wnear" : symbol.toLowerCase();
  const onNear = (await getTokens()).filter((t) => t.blockchain === "near");
  const hit = onNear.find((t) => t.symbol.toLowerCase() === want);
  if (!hit) {
    const known = [...new Set(onNear.map((t) => t.symbol))].join(" ");
    throw new Error(`no NEAR-settled asset for ${symbol}. Known: ${known}`);
  }
  return hit;
}
