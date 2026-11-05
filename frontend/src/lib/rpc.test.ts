/**
 * The transport, not the contract.
 *
 * Both of these guard the same hazard: failover only happens when an attempt
 * *fails*, and a node that accepts the connection and then says nothing never
 * fails. Before the default timeout, three such nodes could hold every slot in
 * the in-flight limit indefinitely and the page simply stopped reading the
 * chain, with no error anywhere to explain it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { rpc } from "./hallmark";

const ok = (value: unknown) =>
  new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: value }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });

afterEach(() => { vi.restoreAllMocks(); });

describe("rpc transport", () => {
  it("bounds every attempt with an abort signal, with no argument asking it to", async () => {
    const fetchMock = vi.fn(async () => ok({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await rpc({ request_type: "x" }, "label");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("fails over to the next endpoint when one hangs until it is aborted", async () => {
    const urls: string[] = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      urls.push(url);
      if (urls.length === 1) {
        // Never resolves on its own: only the abort ends it, which is exactly
        // what an unresponsive node does.
        return await new Promise<Response>((_, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("TimeoutError")));
        });
      }
      return ok({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(rpc({ request_type: "x" }, "label", "query", 30)).resolves.toEqual({ ok: true });
    expect(urls).toHaveLength(2);
    expect(urls[1]).not.toBe(urls[0]);        // a different endpoint, not a retry of the same one
  });
});
