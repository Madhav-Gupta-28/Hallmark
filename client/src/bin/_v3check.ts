import { readFileSync } from "node:fs";
import bs58 from "bs58";
const RPC = "https://rpc.mainnet.near.org";
const V = "hallmarkfi.near";
async function view(method: string, argsJson: string) {
  const r = await fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: {
      request_type: "call_function", finality: "final", account_id: V,
      method_name: method, args_base64: Buffer.from(argsJson).toString("base64") } }) });
  const b: any = await r.json();
  const res = b.result ?? {};
  if (res.error) return `ERR ${String(res.error).slice(0, 150)}`;
  return JSON.parse(Buffer.from(res.result).toString());
}
const dir = "../contract/fixtures/";
const p = (k: string) => `  ${k.padEnd(34)}`;
console.log(`\n  ===== ${V} v3, live on NEAR mainnet =====\n`);
for (const m of ["quote_signer", "mandate_count", "open_mandate_count", "get_mandates"]) {
  console.log(p(m), JSON.stringify(await view(m, "{}")));
}
console.log(p("storage_cost_estimate"),
  (Number(await view("storage_cost_estimate", "{}")) / 1e24).toFixed(5), "NEAR (a recommendation)");

for (const n of ["honest", "worst"]) {
  const canonical = readFileSync(dir + n + ".canonical.json", "utf8");
  const signature = bs58.encode(readFileSync(dir + n + ".sig.bin"));
  const q = JSON.parse(canonical);
  console.log(`\n  --- ${n}.quote.json (signed ${q.timestamp}) ---`);
  console.log(p("is_signed"), await view("is_signed", JSON.stringify({ canonical, signature })));
  console.log(p("quote_age_secs"), await view("quote_age_secs", JSON.stringify({ canonical })));
  console.log(p("worst_cost"), await view("worst_cost", JSON.stringify({ canonical })), "bps");
  console.log(p("realised_cost at full fill"),
    await view("realised_cost", JSON.stringify({ canonical, delivered: q.amountOut })), "bps");
  const terms = (age: number, ceil: number) =>
    `{"origin_asset":${JSON.stringify(q.originAsset)},"destination_asset":${JSON.stringify(q.destinationAsset)},`
    + `"recipient":${JSON.stringify(q.recipient)},"max_cost_bps":${ceil},"max_fill":${JSON.stringify(q.amountIn)},`
    + `"max_quote_age_secs":${age},"expiry_ns":"4000000000000000000"}`;
  const call = (age: number, ceil: number, d: string) =>
    view("dry_check", `{"canonical":${JSON.stringify(canonical)},"signature":${JSON.stringify(signature)},"terms":${terms(age, ceil)},"delivered":${JSON.stringify(d)}}`);
  console.log(p("dry_check @ 300s, 10000 bps"), await call(300, 10_000, q.amountOut));
  console.log(p("dry_check @ 30d, 10000 bps"), await call(30 * 86400, 10_000, q.amountOut));
  console.log(p("dry_check @ 30d, 30 bps"), await call(30 * 86400, 30, q.minAmountOut));
}
console.log();
