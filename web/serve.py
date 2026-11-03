#!/usr/bin/env python3
"""Serve the site locally, with caching turned off.

`python3 -m http.server` sends `Last-Modified` and **no** `Cache-Control`, so a
browser applies heuristic freshness: it reuses the stylesheet and the module
without asking the server whether either changed. Edit a colour, reload, and
nothing happens — which is exactly as confusing as it sounds, because the page
really did change on disk and the server really would have served it.

This sends `Cache-Control: no-store` on everything, so what you see is always
what is in the directory.

    python3 serve.py            # http://localhost:8000
    python3 serve.py 8080
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCache(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):            # one tidy line per request
        code = args[1] if len(args) > 1 else "?"
        if code != "200":
            sys.stderr.write(f"  {args[0]}  -> {code}\n")


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
print(f"  hallmark — http://localhost:{port}   (caching disabled)")
print("  ctrl-c to stop")
ThreadingHTTPServer(("127.0.0.1", port), partial(NoCache, directory=".")).serve_forever()
