/**
 * Node globals that near-api-js 4.0.3 (pulled in by @near-wallet-selector
 * 8.10.2) uses unguarded in browser code, found by grepping the built chunk:
 *   - `Buffer` — 70+ sites, including send_tx and outcome parsing;
 *   - `global.crypto` — read when its random-bytes module initialises;
 *   - `process.nextTick` — on a callback path.
 * Without these, connecting or signing throws a ReferenceError at runtime.
 *
 * Imported first by ./selector.ts, so it only runs in the lazily-loaded wallet
 * chunk; the read-only pages never execute it.
 */
import { Buffer } from "buffer";

const g = globalThis as unknown as Record<string, unknown>;
g.global ??= globalThis;
g.Buffer ??= Buffer;
g.process ??= {
  env: {},
  browser: true,
  nextTick: (f: (...a: unknown[]) => void, ...a: unknown[]) => queueMicrotask(() => f(...a)),
};
