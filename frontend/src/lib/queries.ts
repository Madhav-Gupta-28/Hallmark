import { queryOptions } from "@tanstack/react-query";
import { view, type MandateRecord } from "./hallmark";
import { fetchBook } from "./book";
import { FLOOR, loadTokens } from "./tokens";

export const bookQuery = queryOptions({
  queryKey: ["vault", "get_mandates"],
  queryFn: () => fetchBook(),          // not `fetchBook`: TanStack would pass its context as `read`
  refetchInterval: 30_000,
});

/** One mandate, open or closed. `null` if the id was never used or has been reaped. */
export const mandateQuery = (id: number) => queryOptions({
  queryKey: ["vault", "get_mandate", id],
  queryFn: () => view<MandateRecord | null>("get_mandate", { mandate_id: id }),
  refetchInterval: 30_000,
});

export const openCountQuery = queryOptions({
  queryKey: ["vault", "open_mandate_count"],
  queryFn: () => view<number>("open_mandate_count"),
  refetchInterval: 30_000,
});

/** Never fails the page: if 1Click is down, the floor still names the main pair. */
export const tokensQuery = queryOptions({
  queryKey: ["1click", "tokens"],
  queryFn: loadTokens,
  staleTime: 10 * 60_000,
  retry: 1,
  placeholderData: FLOOR,
});
