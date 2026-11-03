#!/usr/bin/env python3
"""Stamp every asset link with a hash of the file it points at.

A browser that already has `assets/hallmark.css` will not re-request it just
because the file changed — `python3 -m http.server` sends no `Cache-Control`, so
Chrome applies heuristic freshness and serves its copy without asking. Switching
the dev server to `no-store` fixes the *next* fetch, not the one that never
happens. Changing the URL removes the question: `hallmark.css?v=a1b2c3d4` has no
cache entry, so it must be fetched, and the query changes exactly when the file
does.

The ordering matters and is the whole reason this is not a one-liner. `app.js`
imports `wallet.js`, so stamping that import *edits app.js*, which changes
app.js's own hash. Hashing has to run leaves-first: an asset is only hashed once
every reference inside it has been stamped. Getting this backwards ships a page
pointing at a digest that no longer describes anything.

    python3 assets/stamp.py            # restamp
    python3 assets/stamp.py --check    # fail if anything is out of date
"""
import hashlib, pathlib, re, sys

web = pathlib.Path(__file__).resolve().parent.parent
check = "--check" in sys.argv

# Leaves first: nothing in this list may reference anything after it.
ORDER = ["hallmark.css", "hallmark.js", "wallet.js", "app.js"]

def ref(text, name, h, sibling=False):
    """Point every reference to `name` at version `h`.

    Two spellings have to be covered, and missing either one reintroduces
    precisely the stale-cache bug this file exists to prevent:

      * `href="assets/x"` / `from "./assets/x"` — a page referring into assets/
      * `from "./x"`                            — a module inside assets/
        referring to its own sibling, which has no `assets/` in the path at all

    `sibling` selects the second form, used when the file being rewritten is
    itself in assets/.
    """
    if sibling:
        pat = rf'(["\'])\./{re.escape(name)}(\?v=[0-9a-f]+)?\1'
        sub = lambda m: f"{m.group(1)}./{name}?v={h}{m.group(1)}"
    else:
        pat = rf'(["\'])(\./)?assets/{re.escape(name)}(\?v=[0-9a-f]+)?\1'
        sub = lambda m: f"{m.group(1)}{m.group(2) or ''}assets/{name}?v={h}{m.group(1)}"
    return re.sub(pat, sub, text)

digest, stale, changed = {}, [], []

def stamp(path):
    """Rewrite one file's references. Returns True if it was already current."""
    src = path.read_text()
    out = src
    sibling = path.parent.name == "assets"
    for name, h in digest.items():
        out = ref(out, name, h, sibling)
    if out == src:
        return True
    if check:
        stale.append(path.name)
    else:
        path.write_text(out)
        changed.append(path.name)
    return False

# Walk the dependency order, stamping each asset before hashing it.
for name in ORDER:
    p = web / "assets" / name
    if p.suffix in (".js", ".css"):
        stamp(p)
    digest[name] = hashlib.sha256(p.read_bytes()).hexdigest()[:8]

for page in sorted(web.glob("*.html")):
    stamp(page)

for name, h in digest.items():
    print(f"  {name:16} v={h}")

if check:
    if stale:
        print(f"\n  stale: {', '.join(sorted(set(stale)))} — run python3 assets/stamp.py")
        sys.exit(1)
    print("\n  every reference points at the current asset")
else:
    print(f"\n  stamped {len(set(changed))} file(s)" if changed else "\n  already current")
