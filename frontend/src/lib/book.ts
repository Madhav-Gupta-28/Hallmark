import { viewAt, type BookEntry } from "./hallmark";

/** `get_mandates` returns at most `limit` entries; the contract defaults to 50. */
export const PAGE = 50;

export type PageReader = (
  fromIndex: number,
  limit: number,
  blockId?: number,
) => Promise<{ value: BookEntry[]; blockHeight: number }>;

const readPage: PageReader = (from_index, limit, blockId) =>
  viewAt<BookEntry[]>("get_mandates", { from_index, limit }, blockId);

/**
 * The whole open book, as of one block.
 *
 * `get_mandates` (contract/src/lib.rs) sorts the *open* ids and then applies
 * `skip(from_index).take(limit)`, so `from_index` is a position in the open
 * list, not a mandate id. Every open id has a record (`cancel` drops the id;
 * `reap` only deletes closed records), so every page but the last is full and
 * a short page means the end.
 *
 * Positions shift whenever a mandate closes, though. Reading page 2 at a later
 * block than page 1 would skip whichever mandate slid across the boundary. So
 * the first page fixes the block and every later page is read at that block.
 */
export async function fetchBook(read: PageReader = readPage): Promise<BookEntry[]> {
  const first = await read(0, PAGE);
  const all = [...first.value];
  let last = first.value.length;
  for (let from = PAGE; last === PAGE; from += PAGE) {
    const page = await read(from, PAGE, first.blockHeight);
    all.push(...page.value);
    last = page.value.length;
  }
  return all;
}
