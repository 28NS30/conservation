"""Serve the classifier on this machine, in the shape Modal serves it.

    ML_ENDPOINT_TOKEN=<any local secret> ML_DEVICE=mps \\
        python apps/ml/serve_local.py --port 8765

Then run the website with ML_ENDPOINT_URL=http://127.0.0.1:8765 and the same
ML_ENDPOINT_TOKEN, and its classification worker talks to this process
instead of Modal. Both contracts, through the same endpoint.handle() the Modal
app calls, against the embedding files in data/embeddings.

This exists so the whole loop — a report, its photo, the worker, the model,
the rules, the blur — can be run end to end without a GPU bill and without
touching the production service. `apps/web/.env` points ML_ENDPOINT_URL at
production; pass the local URL in the environment, which Next.js lets win
over its .env files, and check this server's log shows the request.

Binds 127.0.0.1 only, and refuses to start without a token: a classifier
anyone on the network can call is a free image service on your machine.
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.path.insert(0, str(pathlib.Path(__file__).parent))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    args = ap.parse_args()

    token = os.environ.get("ML_ENDPOINT_TOKEN")
    if not token:
        raise SystemExit("set ML_ENDPOINT_TOKEN (any local value) — the endpoint refuses callers without it")

    import requests

    from endpoint import handle
    from pipeline import Classifier

    clf = Classifier()
    clf.preload()

    def fetch(url: str) -> tuple[int, bytes]:
        r = requests.get(url, timeout=30)
        return r.status_code, r.content

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802 (http.server's naming)
            length = int(self.headers.get("content-length") or 0)
            try:
                payload = json.loads(self.rfile.read(length) or b"{}")
            except json.JSONDecodeError:
                status, body = 400, {"detail": "not JSON"}
            else:
                status, body = handle(payload, clf=clf, expected_token=token, fetch_image=fetch)
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            contract = payload.get("contract", 1) if isinstance(payload, dict) else "?"
            print(f"[serve_local] contract {contract} -> {status}", flush=True)

        def log_message(self, *a):  # one line per request is printed above
            pass

    server = HTTPServer(("127.0.0.1", args.port), Handler)
    print(f"[serve_local] listening on http://127.0.0.1:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
