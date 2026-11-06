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
  /**
   * `EXACT_INPUT` spends a known amount; `EXACT_OUTPUT` buys one. A filler
   * sourcing inventory needs the second — it knows precisely what the delivery
   * has to be and does not care what that costs, within its own spread. On an
   * `EXACT_OUTPUT` quote the venue returns `minAmountOut == amountOut`, so
   * there is no bridge slippage left to size a buffer against.
   */
  swapType?: "EXACT_INPUT" | "EXACT_OUTPUT";
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
    swapType: p.swapType ?? "EXACT_INPUT",
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

/**
 * Where to send the funds, and what happened to them.
 *
 * `depositAddress` is only present on a `dry: false` quote, and asking for one
 * commits nothing: it reserves an address and expires unused. Note what it is
 * NOT — it is outside the signed payload. The venue signs the amounts and the
 * recipient; the address you are told to pay is advice. That is the hole §2.4
 * is about, and the reason a Hallmark filler risks only its own inventory on
 * it: by the time an owner's escrow moves, the delivery is already in the vault.
 */
export interface Reservation {
  depositAddress: string;
  amountIn: string;
  amountOut: string;
  minAmountOut: string;
  timeEstimate: number;
  deadline: string;
}

/** Terminal states, so a poller knows when to stop rather than when to hope. */
export type SwapStatus =
  | "PENDING_DEPOSIT"
  | "KNOWN_DEPOSIT_TX"
  | "PROCESSING"
  | "SUCCESS"
  | "REFUNDED"
  | "FAILED"
  | "INCOMPLETE_DEPOSIT";

export interface SwapState {
  status: SwapStatus;
  swapDetails: {
    amountOut: string | null;
    amountOutFormatted: string | null;
    originChainTxHashes: { hash: string; explorerUrl?: string }[] | string[];
    destinationChainTxHashes: { hash: string; explorerUrl?: string }[] | string[];
    intentHashes: string[];
    nearTxHashes: string[];
    refundedAmount: string;
    refundReason: string | null;
  };
}

/** What became of a deposit. Keyless, like everything else here. */
export async function getStatus(depositAddress: string): Promise<SwapState> {
  const res = await fetch(
    `${ONECLICK}/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`,
    { headers: { "User-Agent": "hallmark/0.1" } },
  );
  if (!res.ok) throw new Error(`1Click /v0/status -> HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** `[{hash}]` or `["hash"]`, depending on the field. Flatten both. */
export const hashes = (xs: { hash: string }[] | string[] | undefined): string[] =>
  (xs ?? []).map((x) => (typeof x === "string" ? x : x.hash));

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
 * Decimals for the NEAR-settled assets this repo actually uses, so posting a
 * mandate does not depend on the venue being up.
 *
 * Observed on 2026-11-02: `1Click` answered HTTP 521 for an extended period and
 * every call that went through `/v0/tokens` failed with it — including posting a
 * mandate, which needs nothing from 1Click at all. Depending on a venue to
 * learn that wNEAR has 24 decimals is a gap, not a feature. An explicit
 * `nep141:…` id now skips the lookup entirely.
 */
const KNOWN: Record<string, { symbol: string; decimals: number }> = {
  "nep141:wrap.near": { symbol: "wNEAR", decimals: 24 },
  "nep141:usdt.tether-token.near": { symbol: "USDT", decimals: 6 },
  "nep141:usdc.near": { symbol: "USDC", decimals: 6 },
  "nep141:eth.bridge.near": { symbol: "ETH", decimals: 18 },
};

/**
 * Resolve a ticker to the asset settling on NEAR, which is what a vault can
 * hold. `NEAR` is accepted as an alias for `wNEAR`, since that is what anyone
 * types. Of 210 listed assets, 34 settle on NEAR.
 *
 * A full `nep141:…` asset id is returned as-is, with no network call — which is
 * what you want when the venue is down, and what a filler reading a mandate
 * already has in hand.
 */
export async function nearAsset(symbol: string): Promise<TokenInfo> {
  if (symbol.startsWith("nep141:")) {
    const known = KNOWN[symbol];
    if (known) return { assetId: symbol, blockchain: "near", ...known };
    // Unknown id: ask the token contract itself rather than the venue.
    const meta = await nep141Metadata(symbol.slice("nep141:".length));
    return { assetId: symbol, blockchain: "near", ...meta };
  }
  const want = symbol.toLowerCase() === "near" ? "wnear" : symbol.toLowerCase();
  const onNear = (await getTokens()).filter((t) => t.blockchain === "near");
  const hit = onNear.find((t) => t.symbol.toLowerCase() === want);
  if (!hit) {
    const known = [...new Set(onNear.map((t) => t.symbol))].join(" ");
    throw new Error(`no NEAR-settled asset for ${symbol}. Known: ${known}`);
  }
  return hit;
}

/** `ft_metadata` straight off the token, keyless. No dependency on 1Click. */
export async function nep141Metadata(
  tokenAccountId: string,
  rpc = process.env.NEAR_RPC ?? "https://rpc.mainnet.near.org",
): Promise<{ symbol: string; decimals: number }> {
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: tokenAccountId,
        method_name: "ft_metadata",
        args_base64: Buffer.from("{}").toString("base64"),
      },
    }),
  });
  const body = await res.json();
  if (body.result?.error) throw new Error(`ft_metadata on ${tokenAccountId}: ${body.result.error}`);
  const meta = JSON.parse(Buffer.from(body.result.result).toString());
  return { symbol: meta.symbol, decimals: meta.decimals };
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
