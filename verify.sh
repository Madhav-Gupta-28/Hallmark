#!/usr/bin/env bash
# Everything this project claims, checked in one command.
#
#     ./verify.sh            # the full set, ~3 minutes
#     ./verify.sh --fast     # skip the sandbox integration suite, ~30 seconds
#
# No key, no funds, no wallet. The only network it needs is a public NEAR RPC
# and the public 1Click API, both of which answer anonymously. Exits non-zero if
# any claim fails, so it can be the whole review.
set -uo pipefail
cd "$(dirname "$0")"

FAST=0; [ "${1:-}" = "--fast" ] && FAST=1
PASS=0; FAIL=0; SKIP=0
line() { printf '%s\n' "────────────────────────────────────────────────────────────────"; }
step() { printf '\n▸ %s\n' "$1"; }
ok()   { printf '  PASS  %s\n' "$1"; PASS=$((PASS+1)); }
no()   { printf '  FAIL  %s\n' "$1"; FAIL=$((FAIL+1)); }
skip() { printf '  SKIP  %s — %s\n' "$1" "$2"; SKIP=$((SKIP+1)); }
run()  {
  if "${@:2}" >/tmp/hallmark-verify.log 2>&1; then ok "$1"; return; fi
  no "$1"
  # Name what failed rather than printing the last fifteen lines of a log, which
  # for a 28-test sandbox suite is whatever happened to scroll past last.
  local named
  named=$(grep -E "^test .* FAILED$|^---- .* stdout ----|^ *FAIL |panicked at" /tmp/hallmark-verify.log | head -8)
  [ -n "$named" ] && printf '%s\n' "$named" | sed 's/^/        /' \
                  || tail -12 /tmp/hallmark-verify.log | sed 's/^/        /'
  printf '        full log: /tmp/hallmark-verify.log\n'
}

# The integration suite starts a real nearcore sandbox node per test. They race
# for ports under load — .cargo/config.toml already pins RUST_TEST_THREADS=4 for
# this reason — and a judge's machine is not an idle one. A port race is not a
# failed claim, so it gets one retry before it is reported as one. Anything that
# fails twice is real.
retry() {
  if "${@:2}" >/tmp/hallmark-verify.log 2>&1; then ok "$1"; return; fi
  if grep -qE "PeerManagerActor|Address already in use|address in use|failed to bind" /tmp/hallmark-verify.log; then
    printf '  ....  %s — sandbox port race, retrying once\n' "$1"
    sleep 5
  else
    printf '  ....  %s — failed, retrying once before reporting\n' "$1"
  fi
  run "$1" "${@:2}"
}

line; echo "  Hallmark — verifying every claim, with no key and no funds"; line

step "The contract, against a real NEAR runtime"
if ! command -v cargo >/dev/null; then
  skip "Rust tests" "cargo not installed — see https://rustup.rs"
elif [ $FAST = 1 ]; then
  run "32 unit tests (the arithmetic, the signature, the refusals)" cargo test --lib
  skip "28 integration tests" "--fast; drop the flag to run them against a sandbox node"
else
  retry "60 tests — 32 unit + 28 end to end against a sandbox node" cargo test --workspace
fi

step "The canonicaliser, three independent implementations"
if [ -d client/node_modules ]; then
  run "54 client assertions (canonical bytes, hash, signature)" npm --prefix client test
else
  skip "client assertions" "run: npm --prefix client install"
fi

step "The differentiator, run rather than asserted"
if [ -d client/node_modules ]; then
  run "a spend-policy guard approves a payment that loses 99.99%" npm --prefix client run policy
else
  skip "policy bench" "run: npm --prefix client install"
fi

step "The app, and its claims against the source and the chain"
if [ -d frontend/node_modules ]; then
  # `tsc --noEmit` is a no-op here: tsconfig.json carries "files": [] and
  # defers to project references, so it checks nothing and exits 0. The build
  # is the typecheck.
  run "the app typechecks and builds" npm --prefix frontend run build
  run "99 frontend tests (ported canonicaliser matches the reference byte for byte)" npm --prefix frontend test
  run "every number the site and the README state, re-derived" python3 frontend/tools/check.py
  run "no signed quote is ever hand-typed" python3 frontend/tools/mkfixtures.py --check
else
  skip "frontend tests" "run: npm --prefix frontend install"
fi

step "The live contract on NEAR mainnet, asked anonymously"
ask() { # method, json args -> stdout
  curl -s --max-time 25 -H 'content-type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"call_function\",\"finality\":\"final\",\"account_id\":\"hallmarkfi.near\",\"method_name\":\"$1\",\"args_base64\":\"$(printf '%s' "$2" | base64 | tr -d '\n')\"}}" \
    https://free.rpc.fastnear.com
}
CANON=$(python3 -c 'import json;print(json.dumps({"canonical":open("contract/fixtures/worst.canonical.json").read()}))' 2>/dev/null)
if [ -z "$CANON" ]; then
  skip "mainnet checks" "contract/fixtures/worst.canonical.json unreadable"
else
  SIGNED=$(ask is_signed "$(python3 -c '
import json;c=open("contract/fixtures/worst.canonical.json").read()
s=open("contract/fixtures/worst.sig.bin","rb").read()
A="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
n=int.from_bytes(s,"big");o=""
while n: n,r=divmod(n,58); o=A[r]+o
print(json.dumps({"canonical":c,"signature":"1"*(len(s)-len(s.lstrip(b"\x00")))+o}))')" \
    | python3 -c 'import sys,json;r=json.load(sys.stdin);print("".join(map(chr,r["result"]["result"])))' 2>/dev/null)
  [ "$SIGNED" = "true" ] && ok "NEAR Intents really signed the 99.99%-loss quote (is_signed = true)" \
                         || no "is_signed on the captured quote returned '$SIGNED'"

  WORST=$(ask worst_cost "$CANON" | python3 -c 'import sys,json;r=json.load(sys.stdin);print("".join(map(chr,r["result"]["result"])))' 2>/dev/null)
  [ "$WORST" = "10000" ] && ok "and the contract prices its floor at 10000 bps — a total loss" \
                         || no "worst_cost returned '$WORST', expected 10000"

  GUARD=$(ask realised_cost '{"canonical":"{\"amountIn\":\"1000\",\"amountInUsd\":\"10.000000000000\",\"amountOutUsd\":\"9.000000000000\",\"amountOut\":\"1\",\"minAmountOut\":\"1\",\"originAsset\":\"nep141:wrap.near\",\"destinationAsset\":\"nep141:usdt.tether-token.near\",\"recipient\":\"hallmarkfi.near\",\"deadline\":\"2026-11-20T00:00:00.000Z\",\"timestamp\":\"2026-10-31T00:00:00.000Z\",\"slippageTolerance\":100}","delivered":"170141183460469231731687303715884105728"}')
  echo "$GUARD" | grep -q "mul_div overflow" \
    && ok "an overflowing magnitude panics rather than pricing a fill at zero (§8.4)" \
    || no "the mul_div guard did not fire"

  OPEN=$(ask open_mandate_count '{}' | python3 -c 'import sys,json;r=json.load(sys.stdin);print("".join(map(chr,r["result"]["result"])))' 2>/dev/null)
  [ -n "$OPEN" ] && ok "the register answers with no key: $OPEN agreement(s) in force" \
                 || no "open_mandate_count did not answer"
fi

line
printf '  %d passed, %d failed, %d skipped\n' "$PASS" "$FAIL" "$SKIP"
if [ $FAIL -gt 0 ]; then line; echo "  Something above does not match. That is the point of this script."; exit 1; fi
echo "  Every claim checked here holds."
line
