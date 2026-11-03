import { describe, expect, it } from "vitest";
import {
  cancelTxs, CREDIT_SLOT_MARGIN, fundRefusal, fundTxs, loadAccount, reapTxs, storageWithdrawTxs, withdrawTxs,
  type AccountSnapshot, type OwnedMandate, type Reader,
} from "./account";
import { cliFor, txFund, VAULT, type MandateRecord } from "./hallmark";
import { interpret, type ExecutionOutcome } from "./redirect";

const ME = "me.near";
const WNEAR = "nep141:wrap.near";
const USDT = "nep141:usdt.tether-token.near";

const rec = (owner: string, open: boolean, escrow = "5", expiry_ns = "9".repeat(19)): MandateRecord => ({
  owner, open, escrow, delivered: "0", fills: 0, worst_bps: 0,
  terms: {
    origin_asset: WNEAR, destination_asset: USDT, recipient: VAULT,
    max_cost_bps: 300, max_fill: "5", max_quote_age_secs: 300, expiry_ns,
  },
});

/** A vault as the contract shapes it: ids 1..n, reaped ids read as null. */
function vault(records: Array<MandateRecord | null>, credits: Record<string, string>, storage = "0") {
  const calls: Array<{ method: string; args: Record<string, unknown>; block?: number }> = [];
  const r: Reader = async <T,>(method: string, args: Record<string, unknown>, block?: number) => {
    calls.push({ method, args, block });
    const answer = (() => {
      switch (method) {
        case "mandate_count": return records.length;
        case "storage_balance_of": return storage;
        case "get_mandate": return records[Number(args.mandate_id) - 1] ?? null;
        case "get_credit": {
          if (args.asset === "nep141:broken.near") throw new Error("rpc down");
          return args.account_id === ME ? credits[String(args.asset)] ?? "0" : "0";
        }
        default: throw new Error(method);
      }
    })();
    return { value: answer as T, blockHeight: 777 };
  };
  return { r, calls };
}

describe("loadAccount", () => {
  it("finds the owner's mandates — open and closed — and skips reaped and other owners'", async () => {
    const { r } = vault([rec(ME, true), rec("other.near", true), null, rec(ME, false)], {});
    const s = await loadAccount(ME, [WNEAR], () => {}, r);
    expect(s.scanned).toBe(4);
    expect(s.mandates.map((o) => [o.id, o.m.open])).toEqual([[1, true], [4, false]]);
  });

  it("reads every listed asset plus the account's own, and keeps only non-zero credits", async () => {
    const { r, calls } = vault([rec(ME, true)], { [USDT]: "157389", [WNEAR]: "0" });
    const s = await loadAccount(ME, ["nep141:aaa.near"], () => {}, r);
    const asked = calls.filter((c) => c.method === "get_credit").map((c) => c.args.asset).sort();
    expect(asked).toEqual(["nep141:aaa.near", USDT, WNEAR].sort());    // own pair added though not listed
    expect(s.credits).toEqual([{ asset: USDT, amount: "157389" }]);
  });

  it("pins every read after the first to that block", async () => {
    const { r, calls } = vault([rec(ME, true), rec(ME, false)], {});
    await loadAccount(ME, [WNEAR], () => {}, r);
    expect(calls[0]).toMatchObject({ method: "mandate_count", block: undefined });
    expect(calls.slice(1).every((c) => c.block === 777)).toBe(true);
  });

  it("reports a failed credit read instead of calling it zero", async () => {
    const { r } = vault([], {});
    const s = await loadAccount(ME, ["nep141:broken.near", WNEAR], () => {}, r);
    expect(s.creditErrors).toEqual(["nep141:broken.near"]);
  });

  it("reports progress up to the total", async () => {
    const { r } = vault([rec(ME, true), null], {});
    const seen: Array<[number, number]> = [];
    await loadAccount(ME, [WNEAR, USDT], (p) => seen.push([p.done, p.total]), r);
    expect(seen.at(-1)).toEqual([4, 4]);                              // 2 ids + 2 assets
  });
});

describe("cancelTxs", () => {
  const o: OwnedMandate = { id: 3, m: rec(ME, true, "5") };
  const snap = (storage: bigint, credits: AccountSnapshot["credits"] = []): AccountSnapshot =>
    ({ blockHeight: 1, scanned: 3, mandates: [o], credits, creditErrors: [], storage: storage.toString() });

  it("prepays storage first when returning escrow writes a new credit slot and the balance is thin", () => {
    const txs = cancelTxs(o, snap(0n), "1000");
    expect(txs.map((t) => t.actions[0].methodName)).toEqual(["storage_deposit", "cancel"]);
    expect(txs[0].actions[0].deposit).toBe("1000");
  });
  it("does not when the balance covers a slot", () => {
    expect(cancelTxs(o, snap(CREDIT_SLOT_MARGIN), "1000").map((t) => t.actions[0].methodName)).toEqual(["cancel"]);
  });
  it("does not when a credit in that asset already exists (no new slot)", () => {
    expect(cancelTxs(o, snap(0n, [{ asset: WNEAR, amount: "1" }]), "1000")).toHaveLength(1);
  });
  it("does not when there is no escrow to return", () => {
    expect(cancelTxs({ id: 3, m: rec(ME, true, "0") }, snap(0n), "1000")).toHaveLength(1);
  });
  it("cancel, reap, withdraw and storage_withdraw carry the deposits the contract requires", () => {
    const shape = (txs: ReturnType<typeof reapTxs>) => txs.map((t) => [t.receiverId, t.actions[0].methodName, t.actions[0].args, t.actions[0].deposit]);
    expect(shape(cancelTxs(o, snap(CREDIT_SLOT_MARGIN), "1"))).toEqual([[VAULT, "cancel", { mandate_id: 3 }, "0"]]);
    expect(shape(reapTxs(o))).toEqual([[VAULT, "reap", { mandate_id: 3 }, "0"]]);
    expect(shape(withdrawTxs({ asset: USDT, amount: "9" }))).toEqual([[VAULT, "withdraw", { asset: USDT }, "1"]]);
    expect(shape(storageWithdrawTxs())).toEqual([[VAULT, "storage_withdraw", {}, "1"]]);
  });
});

describe("fund", () => {
  it("is ft_transfer_call on the origin token with the contract's tagged Fund action", () => {
    const [t] = fundTxs({ id: 3, m: rec(ME, true) }, "42");
    expect(t.receiverId).toBe("wrap.near");
    expect(t.actions[0]).toMatchObject({ methodName: "ft_transfer_call", deposit: "1", args: { receiver_id: VAULT, amount: "42" } });
    // serde: #[serde(tag = "action", rename_all = "snake_case")] Fund { mandate_id: u64 }
    expect(JSON.parse(t.actions[0].args.msg as string)).toEqual({ action: "fund", mandate_id: 3 });
    expect(txFund(WNEAR, 3, "42")).toEqual(t);
    expect(cliFor([t], ME)).toContain(`'{"receiver_id":"hallmarkfi.near","amount":"42","msg":"{\\"action\\":\\"fund\\",\\"mandate_id\\":3}"}'`);
  });
  it("is refused up front on a closed or expired mandate", () => {
    const now = 1_000;
    expect(fundRefusal({ id: 1, m: rec(ME, false) }, now)).toMatch(/closed/);
    expect(fundRefusal({ id: 1, m: rec(ME, true, "5", String(now * 1_000_000)) }, now)).toMatch(/expired/);
    expect(fundRefusal({ id: 1, m: rec(ME, true) }, now)).toBeNull();
  });
});

describe("interpret — account actions", () => {
  const b64 = (v: unknown) => btoa(JSON.stringify(v));
  const tx = (receiver: string, method: string, args: object, status: object, vaultStatus?: object): ExecutionOutcome => ({
    status,
    transaction: { hash: "H", receiver_id: receiver, actions: [{ FunctionCall: { method_name: method, args: b64(args) } }] },
    receipts_outcome: vaultStatus ? [{ id: "v", outcome: { executor_id: VAULT, logs: [], status: vaultStatus } }] : [],
  });
  const panic = (m: string) => ({ Failure: { ActionError: { index: 0, kind: { FunctionCallError: { ExecutionError: `Smart contract panicked: ${m}` } } } } });

  it("withdraw: true is paid, false is restored", () => {
    expect(interpret(tx(VAULT, "withdraw", { asset: USDT }, { SuccessValue: b64(true) }))).toEqual({ kind: "withdraw", ok: true });
    expect(interpret(tx(VAULT, "withdraw", { asset: USDT }, { SuccessValue: b64(false) })))
      .toMatchObject({ kind: "withdraw", ok: false, reason: expect.stringMatching(/restored/) });
  });
  it("storage_withdraw reads the same callback bool", () => {
    expect(interpret(tx(VAULT, "storage_withdraw", {}, { SuccessValue: b64(true) }))).toEqual({ kind: "storage_withdraw", ok: true });
  });
  it("cancel and reap", () => {
    expect(interpret(tx(VAULT, "cancel", { mandate_id: 3 }, { SuccessValue: "" }))).toEqual({ kind: "cancel", ok: true, mandateId: 3 });
    expect(interpret(tx(VAULT, "cancel", { mandate_id: 3 }, panic("not your mandate"))))
      .toEqual({ kind: "other", ok: false, reason: "Smart contract panicked: not your mandate" });
    expect(interpret(tx(VAULT, "reap", { mandate_id: 3 }, { SuccessValue: b64("2960000000000000000000") })))
      .toEqual({ kind: "reap", ok: true, refunded: "2960000000000000000000" });
  });
  it("fund: whole amount used is a top-up; a vault panic is a refunded refusal", () => {
    const args = { receiver_id: VAULT, amount: "42", msg: JSON.stringify({ action: "fund", mandate_id: 3 }) };
    expect(interpret(tx("wrap.near", "ft_transfer_call", args, { SuccessValue: b64("42") }, { SuccessValue: b64("0") })))
      .toEqual({ kind: "fund", ok: true, mandateId: 3, added: "42" });
    expect(interpret(tx("wrap.near", "ft_transfer_call", args, { SuccessValue: b64("0") }, panic("mandate has expired"))))
      .toEqual({ kind: "fund", ok: false, reason: "Smart contract panicked: mandate has expired" });
    expect(interpret(tx("wrap.near", "ft_transfer_call", args, { SuccessValue: b64("0") }, { SuccessValue: b64("0") })))
      .toMatchObject({ kind: "fund", ok: false });
  });
  it("an open carrying args is still an open", () => {
    const args = { receiver_id: VAULT, amount: "5", msg: JSON.stringify({ action: "open", terms: {} }) };
    const ev = `EVENT_JSON:{"standard":"hallmark","version":"1.0.0","event":"mandate_opened","data":[{"mandate_id":"9","owner":"me.near","escrow":"5"}]}`;
    const o = tx("wrap.near", "ft_transfer_call", args, { SuccessValue: b64("5") }, { SuccessValue: b64("0") });
    o.receipts_outcome[0].outcome.logs.push(ev);
    expect(interpret(o)).toEqual({ kind: "open", ok: true, mandateId: 9, escrowed: "5" });
  });
});
