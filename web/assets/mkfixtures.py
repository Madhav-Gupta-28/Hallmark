#!/usr/bin/env python3
"""Generate web/assets/fixtures.json from the signed captures in contract/fixtures/.

The site must never carry a hand-typed copy of a signed quote. A transcription
error in the canonical bytes or the signature would make `is_signed` answer
`false` on a quote that is genuinely signed — i.e. the page would be quietly
wrong about the one thing it exists to demonstrate. (That happened once, during
this page's first draft: `amountInFormatted` was written as "10" instead of
"10.0", one byte, and the whole fixture stopped verifying.)

So the bytes come from the files, every time:

    python3 web/assets/mkfixtures.py        # regenerate
    python3 web/assets/mkfixtures.py --check  # fail if stale
"""
import hashlib, json, pathlib, sys

A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def b58(b: bytes) -> str:
    n = int.from_bytes(b, "big")
    out = ""
    while n:
        n, r = divmod(n, 58)
        out = A[r] + out
    for byte in b:
        if byte == 0:
            out = "1" + out
        else:
            break
    return out


root = pathlib.Path(__file__).resolve().parents[2]
src = root / "contract" / "fixtures"
dst = root / "web" / "assets" / "fixtures.json"

NOTE = {
    "honest": "A normal quote, for scale: 160 bps guaranteed-worst, 60 bps if honoured in full.",
    "worst": "Cryptographically valid, and guarantees a 99.99% loss. slippageTolerance 9999.",
    "sandbox": "5 wNEAR to ETH, the fixture the sandbox suite is driven by.",
}

out = {}
for name in ("honest", "worst", "sandbox"):
    canonical = (src / f"{name}.canonical.json").read_bytes().decode()
    sig = (src / f"{name}.sig.bin").read_bytes()
    assert len(sig) == 64, f"{name}: a signature is 64 bytes, got {len(sig)}"
    out[name] = {
        "canonical": canonical,
        "signature": b58(sig),
        "bytes": len(canonical.encode()),
        "quoteHash": b58(hashlib.sha256(canonical.encode()).digest()),
        "note": NOTE[name],
    }

text = json.dumps(out, indent=2, sort_keys=True) + "\n"

if "--check" in sys.argv:
    current = dst.read_text() if dst.exists() else ""
    if current != text:
        print("web/assets/fixtures.json is stale — run: python3 web/assets/mkfixtures.py")
        sys.exit(1)
    print("fixtures.json is in sync with contract/fixtures/")
else:
    dst.write_text(text)
    for name, f in out.items():
        print(f"  {name:9} {f['bytes']:4} bytes  {f['quoteHash']}")
