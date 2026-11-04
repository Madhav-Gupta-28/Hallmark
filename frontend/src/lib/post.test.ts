import { describe, expect, it } from "vitest";
import { cliFor, VAULT, type Tx } from "./hallmark";
import { blockers, DEFAULTS, FALLBACK_ESTIMATE, NS_PER_DAY, openTxs, readForm, type Preflight } from "./post";
import { interpret, readCallback, withoutCallback, type ExecutionOutcome } from "./redirect";
import { FLOOR } from "./tokens";

const NOW = 1_793_700_000_000;

describe("readForm", () => {
  it("builds the reference's terms from the tiny defaults, with the vault as recipient", () => {
    const { terms, amount } = readForm({ ...DEFAULTS }, FLOOR, NOW);
    expect(amount).toBe("10000000000000000000000");           // 0.01 wNEAR
    expect(terms).toEqual({
      origin_asset: "nep141:wrap.near",
      destination_asset: "nep141:usdt.tether-token.near",
      recipient: VAULT,
      max_cost_bps: 300,
      max_fill: amount,
      max_quote_age_secs: 300,
      expiry_ns: String(BigInt(NOW) * 1_000_000n + 7n * NS_PER_DAY),
    });
  });

  it.each([
    [{ dest: DEFAULTS.origin }, /must differ/],
    [{ amount: "0" }, /above zero/],
    [{ amount: "0.1234567890123456789012345" }, /more than 24 decimal places/],
    [{ amount: "-1" }, /positive decimal/],
    [{ bps: "0" }, /between 1 and 10000/],
    [{ bps: "10001" }, /between 1 and 10000/],
    [{ bps: "2.5" }, /whole number/],
    [{ ageS: "0" }, /freshness/],
    [{ ageS: "2592001" }, /freshness/],
    [{ days: "0" }, /expiry/],
    [{ origin: "nep141:mystery.near" }, /decimals are unknown/],
  ])("refuses %o", (patch, err) => {
    expect(() => readForm({ ...DEFAULTS, ...patch }, FLOOR, NOW)).toThrow(err);
  });
});

describe("openTxs", () => {
  const { terms, amount } = readForm({ ...DEFAULTS }, FLOOR, NOW);

  it("prepays storage first when the balance is below the estimate", () => {
    const txs = openTxs(terms, amount, "0", FALLBACK_ESTIMATE);
    expect(txs.map((t) => [t.receiverId, t.actions[0].methodName, t.actions[0].deposit])).toEqual([
      [VAULT, "storage_deposit", FALLBACK_ESTIMATE],
      ["wrap.near", "ft_transfer_call", "1"],
    ]);
    expect(JSON.parse(txs[1].actions[0].args.msg as string)).toEqual({ action: "open", terms });
    expect(txs[1].actions[0].args).toMatchObject({ receiver_id: VAULT, amount });
  });

  it("is one transaction when storage is already prepaid", () => {
    expect(openTxs(terms, amount, FALLBACK_ESTIMATE, FALLBACK_ESTIMATE)).toHaveLength(1);
  });

  it("renders a CLI command for every action, signed as the account", () => {
    const cmd = cliFor(openTxs(terms, amount, "0", FALLBACK_ESTIMATE), "me.near");
    expect(cmd.match(/near contract call-function as-transaction/g)).toHaveLength(2);
    expect(cmd).toContain("sign-as me.near network-config mainnet");
    expect(cmd).toContain("attached-deposit '1 yoctoNEAR'");
  });
});

describe("blockers", () => {
  const txs: Tx[] = openTxs(readForm({ ...DEFAULTS }, FLOOR, NOW).terms, "10", "0", FALLBACK_ESTIMATE);
  const ok: Preflight = {
    estimate: FALLBACK_ESTIMATE, prepaid: "0", tokenBalance: "10",
    vaultRegistered: true, nearAvailable: (10n ** 24n).toString(),
  };
  it("lets a funded, registered account through", () => {
    expect(blockers(ok, txs, "10", "wNEAR", 24)).toEqual([]);
  });
  it("stops an unregistered vault, a short token balance, and too little NEAR", () => {
    const b = blockers({ ...ok, vaultRegistered: false, tokenBalance: "9", nearAvailable: "0" }, txs, "10", "wNEAR", 24);
    expect(b).toHaveLength(3);
    expect(b.join(" ")).toMatch(/not storage-registered/);
    expect(b.join(" ")).toMatch(/less than the amount/);
    expect(b.join(" ")).toMatch(/NEAR for deposits and gas/);
  });
});

describe("the wallet redirect callback", () => {
  it("reads the hashes it returns", () => {
    expect(readCallback("?transactionHashes=AAA,BBB")).toEqual({ kind: "signed", hashes: ["AAA", "BBB"] });
  });
  it("reads a rejection", () => {
    expect(readCallback("?errorCode=userRejected&errorMessage=User%20rejected"))
      .toEqual({ kind: "error", code: "userRejected", message: "User rejected" });
  });
  it("ignores an ordinary URL", () => {
    expect(readCallback("?foo=1")).toBeNull();
  });
  it("strips only the wallet's parameters", () => {
    expect(withoutCallback("https://x.app/post?transactionHashes=A&keep=1#h")).toBe("/post?keep=1#h");
    expect(withoutCallback("https://x.app/post?errorCode=e&errorMessage=m")).toBe("/post");
  });
});

describe("interpret", () => {
  const b64 = (v: unknown) => btoa(JSON.stringify(v));
  const ftCall = (vaultStatus: object, logs: string[] = [], top: object = { SuccessValue: b64("10") }): ExecutionOutcome => ({
    status: top,
    transaction: { hash: "H", receiver_id: "wrap.near", actions: [{ FunctionCall: { method_name: "ft_transfer_call" } }] },
    receipts_outcome: [
      { id: "1", outcome: { executor_id: "wrap.near", logs: [], status: { SuccessReceiptId: "2" } } },
      { id: "2", outcome: { executor_id: VAULT, logs, status: vaultStatus } },
    ],
  });

  it("finds the opened mandate in the vault's own event", () => {
    const ev = `EVENT_JSON:{"standard":"hallmark","version":"1.0.0","event":"mandate_opened","data":[{"mandate_id":"7","owner":"me.near","escrow":"10"}]}`;
    expect(interpret(ftCall({ SuccessValue: b64("0") }, [ev]))).toEqual({ kind: "open", ok: true, mandateId: 7, escrowed: "10" });
  });

  it("reports the vault's refusal even though ft_transfer_call itself succeeded (refunded)", () => {
    const fail = { Failure: { ActionError: { index: 0, kind: { FunctionCallError: {
      ExecutionError: "Smart contract panicked: the quote's recipient must be this vault, or the delivery cannot be verified",
    } } } } };
    expect(interpret(ftCall(fail, [], { SuccessValue: b64("0") }))).toEqual({
      kind: "open", ok: false,
      reason: "Smart contract panicked: the quote's recipient must be this vault, or the delivery cannot be verified",
    });
  });

  it("reads a storage deposit's credited balance", () => {
    expect(interpret({
      status: { SuccessValue: b64("10230000000000000000000") },
      transaction: { hash: "H", receiver_id: VAULT, actions: [{ FunctionCall: { method_name: "storage_deposit" } }] },
      receipts_outcome: [],
    })).toEqual({ kind: "storage_deposit", ok: true, credited: "10230000000000000000000" });
  });
});
