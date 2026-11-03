#!/usr/bin/env python3
"""Stamp the asset links with a hash of their contents.

A browser that has `assets/hallmark.css` cached will not re-request it just
because the file changed — `python3 -m http.server` sends no `Cache-Control`,
so Chrome applies heuristic freshness and serves its copy without asking.
Switching the dev server to `no-store` fixes the *next* fetch, not the one that
never happens.

Changing the URL removes the question entirely: `hallmark.css?v=a1b2c3d4` has no
cache entry, so it must be fetched. The query is a hash of the file, so it
changes exactly when the file does and never otherwise.

    python3 assets/stamp.py            # restamp
    python3 assets/stamp.py --check    # fail if any page is out of date
"""
import hashlib, pathlib, re, sys

web = pathlib.Path(__file__).resolve().parent.parent
digest = {
    name: hashlib.sha256((web / "assets" / name).read_bytes()).hexdigest()[:8]
    for name in ("hallmark.css", "hallmark.js")
}

stale, changed = [], []
for page in sorted(web.glob("*.html")):
    src = out = page.read_text()
    for name, h in digest.items():
        # `href="assets/x"` in the markup and `from "./assets/x"` in the module
        # imports, so the optional `./` has to be part of the pattern.
        out = re.sub(
            rf'(["\'])(\./)?assets/{re.escape(name)}(\?v=[0-9a-f]+)?\1',
            lambda m: f"{m.group(1)}{m.group(2) or ''}assets/{name}?v={h}{m.group(1)}",
            out,
        )
    if out != src:
        (stale if "--check" in sys.argv else changed).append(page.name)
        if "--check" not in sys.argv:
            page.write_text(out)

for name, h in digest.items():
    print(f"  {name:16} v={h}")
if "--check" in sys.argv:
    if stale:
        print(f"\n  stale: {', '.join(stale)} — run python3 assets/stamp.py")
        sys.exit(1)
    print("\n  every page links the current assets")
else:
    print(f"\n  stamped {len(changed)} page(s)" if changed else "\n  already current")
