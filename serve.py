#!/usr/bin/env python3
"""serve.py - run the site locally for testing (standard library only).

    python serve.py [--port 8000] [--open]

Opens nothing outside this folder. Map images still come from the Dropbox links in static/js/maps.config.js.
Responses are sent with no-cache so edits show up on refresh. (`python -m http.server` also works.)
"""
import argparse, os, threading, webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

class NoCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

ap = argparse.ArgumentParser()
ap.add_argument("--port", type=int, default=8000)
ap.add_argument("--open", action="store_true")
a = ap.parse_args()
root = os.path.dirname(os.path.abspath(__file__))
url = f"http://localhost:{a.port}/"
print(f"Serving {root}\n  -> {url}   (Ctrl+C to stop)")
if a.open:
    threading.Timer(0.5, lambda: webbrowser.open(url)).start()
try:
    ThreadingHTTPServer(("127.0.0.1", a.port), partial(NoCache, directory=root)).serve_forever()
except KeyboardInterrupt:
    print("\nstopped")
