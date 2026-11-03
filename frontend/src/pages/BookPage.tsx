import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { MandateCard } from "@/components/MandateCard";
import { EXPLORER, VAULT } from "@/lib/hallmark";
import { bookQuery, openCountQuery, tokensQuery } from "@/lib/queries";

export function BookPage() {
  const book = useQuery(bookQuery);
  const open = useQuery(openCountQuery);
  const tokens = useQuery(tokensQuery);
  const table = tokens.data ?? {};

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <header className="mb-8 space-y-3">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          The vault · live on NEAR mainnet
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">The open book</h1>
        <p className="max-w-2xl text-muted-foreground">
          Every mandate the vault currently holds, straight from <code>get_mandates</code> on{" "}
          <a className="underline" href={`${EXPLORER}/address/${VAULT}`} target="_blank" rel="noreferrer">
            {VAULT}
          </a>
          . Each one is an order with its own bound attached: the owner escrowed the input and named the
          worst all-in cost they will accept. Reading needs no wallet.
        </p>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Badge variant="outline">
            {open.isSuccess ? `${open.data} open` : open.isError ? "count unavailable" : "counting…"}
          </Badge>
          {tokens.isError && (
            <Badge variant="outline" className="text-muted-foreground">
              1Click token list unavailable — unknown tokens shown in base units
            </Badge>
          )}
          {book.dataUpdatedAt > 0 && (
            <span className="text-muted-foreground">
              read {new Date(book.dataUpdatedAt).toLocaleTimeString()}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => { void book.refetch(); void open.refetch(); }}
            disabled={book.isFetching}
          >
            <RefreshCw className={book.isFetching ? "animate-spin" : ""} />
            Refresh
          </Button>
        </div>
      </header>

      {book.isPending && (
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1].map((i) => <Skeleton key={i} className="h-80" />)}
        </div>
      )}

      {book.isError && (
        <Alert variant="destructive">
          <AlertTitle>Could not read the book</AlertTitle>
          <AlertDescription>{book.error.message}</AlertDescription>
        </Alert>
      )}

      {book.isSuccess && book.data.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            The vault holds no open mandate right now.
          </CardContent>
        </Card>
      )}

      {book.isSuccess && book.data.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {book.data.map(([id, m]) => (
            <MandateCard key={id} id={id} m={m} table={table} readAt={book.dataUpdatedAt} link />
          ))}
        </div>
      )}

      <p className="mt-8 text-xs text-muted-foreground">
        ↳ <code>get_mandates</code> reads the contract's index of open mandates only, so this costs what
        the vault holds rather than everything it has ever recorded. Refreshes every 30 s.
      </p>
    </div>
  );
}
