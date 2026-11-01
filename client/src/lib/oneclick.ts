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
  if (!res.ok) {
    // 1Click answers HTTP 400 "Internal server error" when the recipient is not
    // an existing on-chain NEAR account. That reads like an outage and is not,
    // so say what it actually means (ARCHITECTURE.md §3.11).
    if (res.status === 400 && text.includes("Internal server error")) {
      const rcpt = (body as { recipient?: string }).recipient;
      throw new Error(
        `1Click rejected the quote. The most common cause is that the recipient ` +
          `(${rcpt ?? "unset"}) does not exist on-chain yet — create the account first.\n` +
          `  raw: ${text.slice(0, 200)}`,
      );
    }
    throw new Error(`1Click ${path} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
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

/**
 * A human amount ("0.1") to base units, exactly.
 *
 * `Math.round(Number(h) * 10 ** decimals)` is the obvious version and it is
 * wrong: wNEAR has 24 decimals, and a float64 cannot hold 1e23, so "0.1 wNEAR"
 * becomes 100000000000000008388608 — off by 8,388,608 base units. Every amount
 * in this project is an exact integer and must be built as one.
 */
export function parseUnits(human: string, decimals: number): bigint {
  const t = human.trim();
  if (!/^\d+(\.\d+)?$/.test(t)) throw new Error(`not a positive decimal amount: "${human}"`);
  const [int, frac = ""] = t.split(".");
  if (frac.length > decimals) {
    throw new Error(`${human} has more than ${decimals} decimal places`);
  }
  return BigInt(int + frac.padEnd(decimals, "0"));
}

/** Base units back to a human string, exactly. */
export function formatUnits(amount: bigint, decimals: number): string {
  const s = amount.toString().padStart(decimals + 1, "0");
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return s.slice(0, s.length - decimals) + (frac ? "." + frac : "");
}
