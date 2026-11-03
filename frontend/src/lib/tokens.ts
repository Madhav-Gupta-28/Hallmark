/**
 * Token symbols and decimals, ported from web/assets/app.js.
 *
 * The venue is the authority, but it can be down, so the pair this vault is
 * actually used with is a hard-coded floor and whatever 1Click reports merges
 * over the top. One deliberate difference from the reference: app.js assumes
 * 18 decimals for an asset it has never heard of. Here an unknown asset has
 * `dp: null`, and the UI shows raw base units instead of a guessed figure.
 */
import { getTokens, tokenOf } from "./hallmark";

export interface TokenMeta {
  symbol: string;
  dp: number | null;
}

export type TokenTable = Record<string, { symbol: string; dp: number }>;

export const FLOOR: TokenTable = {
  "nep141:wrap.near": { symbol: "wNEAR", dp: 24 },
  "nep141:usdt.tether-token.near": { symbol: "USDT", dp: 6 },
};

/** The NEAR-chain token list from 1Click, merged over the floor. */
export async function loadTokens(): Promise<TokenTable> {
  const out: TokenTable = { ...FLOOR };
  for (const t of await getTokens()) {
    if (t.blockchain === "near") out[t.assetId] = { symbol: t.symbol, dp: t.decimals };
  }
  return out;
}

export function meta(table: TokenTable, asset: string): TokenMeta {
  const hit = table[asset];
  if (hit) return hit;
  return { symbol: tokenOf(asset).split(".")[0].toUpperCase(), dp: null };
}
