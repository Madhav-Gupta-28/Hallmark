/**
 * `fetchBook` against a model of contract/src/lib.rs `get_mandates`:
 * sort the open ids, `skip(from_index)`, `take(limit)`, at a given block.
 */
import { describe, expect, it } from "vitest";
import { fetchBook, PAGE, type PageReader } from "./book";
import type { BookEntry, MandateRecord } from "./hallmark";

const rec = {} as MandateRecord;

/**
 * A chain whose open set at block h is `openAt[h]`. The first read sees block
 * 0; by the time of any later read the chain has moved on to the last block,
 * so an unpinned second page would see the newer state.
 */
function chain(openAt: number[][]) {
  const calls: Array<{ from: number; block?: number }> = [];
  let latest = 0;
  const read: PageReader = async (from, limit, blockId) => {
    calls.push({ from, block: blockId });
    const h = blockId ?? latest;
    latest = openAt.length - 1;
    const open = [...openAt[h]].sort((a, b) => a - b);
    return { value: open.slice(from, from + limit).map((id): BookEntry => [id, rec]), blockHeight: h };
  };
  return { read, calls };
}

const range = (a: number, b: number) => Array.from({ length: b - a }, (_, i) => a + i);
const ids = (b: BookEntry[]) => b.map(([id]) => id);

describe("fetchBook", () => {
  it("reads an empty book in one call", async () => {
    const c = chain([[]]);
    expect(await fetchBook(c.read)).toEqual([]);
    expect(c.calls).toHaveLength(1);
  });

  it("stops on a short page", async () => {
    const c = chain([range(1, 121)]);              // 120 open: 50, 50, 20
    expect(ids(await fetchBook(c.read))).toEqual(range(1, 121));
    expect(c.calls.map((x) => x.from)).toEqual([0, 50, 100]);
  });

  it("needs one extra empty read when the book is an exact multiple of a page", async () => {
    const c = chain([range(1, 2 * PAGE + 1)]);
    expect(ids(await fetchBook(c.read))).toEqual(range(1, 2 * PAGE + 1));
    expect(c.calls.map((x) => x.from)).toEqual([0, 50, 100]);
  });

  it("reads every later page at the first page's block", async () => {
    const c = chain([range(1, 121)]);
    await fetchBook(c.read);
    expect(c.calls.map((x) => x.block)).toEqual([undefined, 0, 0]);
  });

  it("does not skip a mandate when one on an earlier page closes mid-read", async () => {
    // block 0: ids 1..60 open. block 1: #10 closed, so #51 slides to position 49.
    const before = range(1, 61);
    const after = before.filter((id) => id !== 10);
    const c = chain([before, after]);
    const got = ids(await fetchBook(c.read));
    expect(got).toEqual(before);                  // the consistent book as of block 0

    // The unpinned loop this replaced would have read page 2 at block 1 and
    // started at #52, losing #51 entirely.
    const page2Unpinned = after.slice(PAGE, 2 * PAGE);
    expect(page2Unpinned[0]).toBe(52);
  });
});
