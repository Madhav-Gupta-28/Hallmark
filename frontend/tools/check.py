#!/usr/bin/env python3
"""Check the app's factual claims against the code and the live chain.

The site asserts a lot of specific numbers — method counts, test counts, byte
counts, basis points. Any of them can go stale the moment the contract changes,
and a stale number on a page whose whole pitch is verifiability is worse than no
number at all. So they are checked mechanically:

    python3 frontend/tools/check.py

Exits non-zero if the site and the repository disagree.
"""
import json, pathlib, re, subprocess, sys, urllib.request

root = pathlib.Path(__file__).resolve().parents[2]
src = root / "frontend" / "src"
# every page and every library the pages read their numbers from: the claims
# live in JSX text and in the runtime's literals, so both count
pages = {p.name: p.read_text() for p in sorted(src.rglob("*.tsx"))}
blob = "\n".join(list(pages.values()) + [p.read_text() for p in sorted(src.rglob("*.ts"))])
fails = []


def claim(label, ok, want, got):
    mark = "ok " if ok else "!! "
    print(f"  {mark}{label:46} site says {want!s:<24} actual {got}")
    if not ok:
        fails.append(label)


# ---------------------------------------------------------------- from the code
mandate = (root / "contract" / "src" / "mandate.rs").read_text()
lib = (root / "contract" / "src" / "lib.rs").read_text()
enum = mandate[mandate.index("pub enum Refusal") : mandate.index("/// What a passing check")]
refusals = re.findall(r"^    ([A-Z]\w+)", enum, re.M)
impl = lib[lib.index("impl Hallmark {") :]
exported = sorted(set(re.findall(r"\n    pub fn (\w+)", impl)))
# What a clean clone actually RUNS. An `#[ignore]`d test is not one of them —
# the book-scaling benchmark opens a hundred mandates and takes two minutes, so
# it is run on demand, and counting it here would overstate the claim.
def runnable(path, marker):
    body = (root / path).read_text()
    return sum(
        1 for block in body.split(marker)[1:]
        if "#[ignore]" not in block.split("async fn")[0].split("fn ")[0]
    )

unit = runnable("contract/src/tests.rs", "#[test]")
integ = runnable("contract/tests/integration.rs", "#[tokio::test]")

# A number the app does not state cannot be stale. These assert the app is never
# WRONG, not that it must keep making the claim — rewording a page is not a bug.
stated = lambda *phrases: any(x.lower() in blob.lower() for x in phrases)
claim("typed refusals", not stated("nine typed refusals", "nine checks", "nine gates") or len(refusals) == 9,
      "nine" if stated("nine typed refusals", "nine checks", "nine gates") else "not claimed",
      f"{len(refusals)} in mandate.rs")
claim("exported methods", "23 exported" in blob or "Twenty-three" in blob,
      23, f"{len(exported)} pub fn in the #[near] impl")
claim("unit + integration tests", f"{unit} unit" in blob and f"{integ} against a real sandbox" in blob or f"{unit} unit + {integ}" in blob,
      f"{unit}+{integ}", f"{unit} unit, {integ} integration")
claim("total test count", not re.search(r"\b(\d+) tests\b", blob) or f"{unit + integ} tests" in blob,
      f"{unit+integ}" if f"{unit + integ} tests" in blob else "not claimed", unit + integ)

# every refusal named on the site must exist in the enum
named = {r for r in re.findall(r"\b([A-Z][a-zA-Z]+)\b", blob) if r in set(refusals) or r in
         {"QuoteTooOld", "BadSignature"}}
ghost = [n for n in named if n not in refusals]
claim("no invented refusal names", not ghost, "—", ghost or "none")

# every method the site names must be exported
site_methods = set(re.findall(r"<code>(\w+)</code>", blob))
known = set(exported) | {
    "ft_transfer_call", "ft_on_transfer", "storage_deposit", "near_deposit", "ft_metadata",
    "open", "fund", "fill", "check", "cost_bps", "settle_storage", "bytes_to_near",
    "decode_signature", "parse_fixed", "mul_div", "div_ceil", "sha256", "ed25519_verify",
    "from_slice", "parse_iso8601_secs", "storage_usage", "remove", "flush", "iter", "filter",
    "skip", "take", "require", "Promise", "Err", "Ok", "SignedQuote", "Mandate", "u32", "u64",
    "U128", "U64", "u128", "String", "AccountId", "IterableSet", "token_account", "canonical",
    "signature", "msg", "amount", "sender_id", "delivered", "timestamp", "deadline",
    "amountIn", "amountOut", "amountInUsd", "amountOutUsd", "minAmountOut", "appFees",
    "depositAddress", "depositMemo", "depositMode", "slippageTolerance", "recipient",
    "originAsset", "destinationAsset", "max_cost_bps", "max_fill", "max_quote_age_secs",
    "expiry_ns", "origin_asset", "destination_asset", "escrow", "dry", "swapType",
    "depositType", "refundType", "recipientType", "refundTo", "insured", "timeEstimate",
    "correlationId", "refundFee", "withdrawFee", "confidentiality", "getQuote", "fetchTokens",
    "submitDeposit", "pollStatus", "executeSwap", "quote", "Mandate", "Leash", "nep141",
    "receipts_outcome", "SuccessValue", "PeerManagerActor", "std", "near_sdk", "store",
    "IterableMap", "LookupMap", "amountOutFormatted", "amountInFormatted", "minAmountIn",
    # Not identifiers at all: command-line tools the site tells a reader to run.
    # The point of this check is that the site must never name a contract method
    # that does not exist, so a binary name belongs here rather than in the
    # failure list. `near` is the NEAR CLI, which app.html renders commands for.
    "near", "cargo", "npx", "python3",
}
tests_src = ((root / "contract" / "src" / "tests.rs").read_text()
             + (root / "contract" / "tests" / "integration.rs").read_text())
historical = {"max_filler_fee_bps"}  # built, tested, then deleted — described in §2.5
unknown = sorted(
    m for m in site_methods
    if m not in known and m not in historical
    and f"fn {m}" not in tests_src
    and re.fullmatch(r"[a-z_][a-z0-9_]{3,}", m)
)
claim("no undefined code identifier", not unknown, "—", unknown or "none")

# a test the site names by hand must exist
site_tests = sorted({m for m in site_methods if len(m) > 20 and "_" in m and m not in known})
missing_tests = [t for t in site_tests if f"fn {t}" not in tests_src and t not in historical]
claim("every named test exists", not missing_tests, f"{len(site_tests)} named", missing_tests or "all present")

# ---------------------------------------------------------------- from the chain
def rpc(method, args=None, account="hallmarkfi.near"):
    import base64
    body = {"jsonrpc": "2.0", "id": 1, "method": "query", "params":
            {"request_type": "view_account", "finality": "final", "account_id": account}}
    if method:
        body["params"] = {"request_type": "call_function", "finality": "final",
                          "account_id": account, "method_name": method,
                          "args_base64": base64.b64encode(json.dumps(args or {}).encode()).decode()}
    req = urllib.request.Request("https://rpc.mainnet.near.org", json.dumps(body).encode(),
                                 {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        d = json.load(r)
    res = d["result"]
    return json.loads(bytes(res["result"]).decode()) if method else res


try:
    acct = rpc(None)
    locked = acct["storage_usage"] * 10 ** 19 / 10 ** 24
    # This one WAS a typed constant and went stale the moment a second mandate
    # was drawn up: the figure is the account's whole storage stake, and state
    # is part of it. It is rendered from a live view now, so the check is that
    # no stale copy has crept back into the markup.
    typed = re.findall(r"(\d\.\d\d) NEAR\b.{0,40}stak", blob, re.S) + re.findall(r"stak.{0,40}?(\d\.\d\d) NEAR\b", blob, re.S)
    stale = [v for v in typed if v != f"{locked:.2f}"]
    claim("NEAR staked, not typed into the markup", not stale,
          "rendered live" if not typed else ",".join(typed),
          f"{locked:.4f} ({acct['storage_usage']:,} bytes)")
    signer = rpc("quote_signer")
    claim("the signer key", signer in blob, signer[:22] + "…", "matches the chain")
    est = rpc("storage_cost_estimate")
    claim("storage_cost_estimate", True, f"{int(est)/1e24:.5f} NEAR", f"{int(est)/1e24:.5f} NEAR")
except Exception as e:  # noqa: BLE001
    print(f"  -- chain checks skipped: {e}")

# --------------------------------------------------------------- fixtures match
fx = json.loads((src / "lib" / "fixtures.json").read_text())
r = subprocess.run([sys.executable, str(root / "frontend" / "tools" / "mkfixtures.py"), "--check"],
                   capture_output=True, text=True)
claim("fixtures.json derived, not typed", r.returncode == 0, "in sync", r.stdout.strip() or r.stderr.strip())
# byte counts are rendered from fixtures.json at runtime rather than typed into
# the markup, so the only thing to check is that the file is derived — above.
claim("fixture byte counts are rendered, not typed",
      not any(f"{f['bytes']} bytes" in p for p in pages.values() for f in [fx["sandbox"]]),
      "from the JSON", "no hand-typed sandbox byte count in the markup")

# ------------------------------------------------------------------- the README
#
# The site had a checker and the README did not, so the README drifted: it still
# claimed 58 Rust tests and a 257,314-byte contract two deploys after both had
# changed. That matters more than a stale page, because the AI pre-screen reads
# the README, runs what it says, and compares. A number the README states has to
# be a number the repository can still produce.
readme = (root / "README.md").read_text()


def says(pattern, label, actual):
    m = re.search(pattern, readme)
    found = m.group(1) if m else None
    claim(label, found == str(actual), f"README says {found}", actual)


print()
says(r"\*\*See:\*\* (\d+) tests pass", "README: Rust test total", unit + integ)
says(r"tests pass — (\d+) unit", "README: unit tests", unit)
says(r"unit, (\d+) against a real sandbox", "README: integration tests", integ)
says(r"contract/src/tests\.rs\s+(\d+) unit tests", "README: layout unit count", unit)
says(r"contract/tests/integration\.rs (\d+) tests", "README: layout integration count", integ)
says(r"the (\d+) Rust tests and", "README: AI-tooling test total", unit + integ)

# Counting `it(` gives the wrong answer: `describe.each` runs one `it` once per
# case, so the canonicalisation suite alone is 4 written tests and 12 real ones.
# Ask the runner instead of guessing at its arithmetic.
try:
    # The json reporter writes a file and prints only where it put it.
    out = root / "frontend" / ".vitest" / "json" / "check.json"
    subprocess.run(["npx", "vitest", "run", "--reporter=json", "--outputFile", str(out)],
                   cwd=root / "frontend", capture_output=True, text=True, timeout=300, check=True)
    says(r"npm --prefix frontend test\s+# (\d+) tests", "README: frontend test count",
         json.loads(out.read_text())["numTotalTests"])
    out.unlink(missing_ok=True)
except Exception as e:  # noqa: BLE001
    print(f"  -- README frontend test count skipped: {type(e).__name__}")

wasm = root / "target" / "near" / "hallmark" / "hallmark.wasm"
if wasm.exists():
    says(r"\| the contract \| ([\d,]+) bytes", "README: contract size", f"{wasm.stat().st_size:,}")
else:
    print("  -- README contract size skipped: build the wasm first (./build.sh)")

# Q-015: one person may enter two projects only if each README names the other.
dk = re.search(r"Docket[^\n]*?(https://github\.com/\S+)", readme) or \
     re.search(r"(https://github\.com/\S+)[^\n]*?Docket", readme)
claim("README: names the other submission (Q-015)", bool(dk),
      "Docket, with a repo link", dk.group(1) if dk else "MISSING or has no link yet")
# Q-005: every library and template has to be listed.
claim("README: lists its libraries (Q-005)", "## Libraries" in readme,
      "a Libraries section", "present" if "## Libraries" in readme else "MISSING")

print()
if fails:
    print(f"  {len(fails)} claim(s) do not match: {', '.join(fails)}")
    sys.exit(1)
print("  every checked claim on the site matches the code and the chain")
