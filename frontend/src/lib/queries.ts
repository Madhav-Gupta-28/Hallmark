import { queryOptions } from "@tanstack/react-query";
import { view } from "./hallmark";
import { fetchBook } from "./book";
import { FLOOR, loadTokens } from "./tokens";

export const bookQuery = queryOptions({
  queryKey: ["vault", "get_mandates"],
  queryFn: () => fetchBook(),          // not `fetchBook`: TanStack would pass its context as `read`
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
