"""Smoke-test a classifier endpoint in both contracts, with one photograph.

    ML_ENDPOINT_URL=... ML_ENDPOINT_TOKEN=... \\
      python apps/ml/smoke.py --image data/evalset/images/5938615954.jpg \\
                              --expect "Duttaphrynus melanostictus"

Run after every `modal deploy`, before the website is switched to the new
contract, and again after. It checks what a deploy can break without anything
crashing:

  1. a wrong token is refused (401), whichever contract it asks for;
  2. a request with no "contract" is answered exactly in the legacy shape,
     top 5 `taxa.id`s from the v1 files — what the live website reads until
     ML_CONTRACT=2;
  3. "contract": 2 is answered with 50 species, most probable first, keyed by
     TaiCOL id, from the v2 files;
  4. with DATABASE_URL set, both top answers resolve in that database to the
     species given by --expect (at the binomial).

The token and URL are read from the environment and never printed. Costs one
cold start and three GPU calls.
"""

from __future__ import annotations

import argparse
import base64
import os
import pathlib
import sys

import requests


def fail(msg: str) -> None:
    print(f"  FAIL  {msg}")
    sys.exit(1)


def ok(msg: str) -> None:
    print(f"  ok    {msg}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", type=pathlib.Path, required=True)
    ap.add_argument("--expect", help="scientific name the photograph shows")
    args = ap.parse_args()

    url = os.environ.get("ML_ENDPOINT_URL")
    token = os.environ.get("ML_ENDPOINT_TOKEN")
    if not url or not token:
        raise SystemExit("set ML_ENDPOINT_URL and ML_ENDPOINT_TOKEN")
    image = base64.b64encode(args.image.read_bytes()).decode()

    def post(body: dict) -> requests.Response:
        return requests.post(url, json=body, timeout=180)

    for body in ({"token": "smoke-invalid", "category": "roadkill"},
                 {"token": "smoke-invalid", "contract": 2, "imageBase64": image}):
        r = post(body)
        if r.status_code != 401:
            fail(f"a bad token got {r.status_code}, expected 401 ({'contract 2' if 'contract' in body else 'legacy'})")
    ok("a bad token is refused in both contracts")

    r = post({"token": token, "imageBase64": image, "category": "roadkill"})
    if r.status_code != 200:
        fail(f"legacy contract answered {r.status_code}: {r.text[:200]}")
    legacy = r.json()
    preds = legacy.get("predictions") or []
    if "candidates" in legacy or len(preds) != 5 or legacy.get("band") not in ("high", "medium", "low"):
        fail(f"legacy contract answered in the wrong shape: keys {sorted(legacy)}")
    if legacy.get("modelVersion") != "bioclip2-vitl14-v1":
        fail(f"legacy contract answered from {legacy.get('modelVersion')}, expected bioclip2-vitl14-v1")
    ok(f"legacy contract: top-1 taxa.id {preds[0]['taxon_id']} at {preds[0]['score']:.3f}, band {legacy['band']}")

    r = post({"token": token, "imageBase64": image, "contract": 2})
    if r.status_code != 200:
        fail(f"contract 2 answered {r.status_code}: {r.text[:200]} — are the v2 files on the volume?")
    ev = r.json()
    cands = ev.get("candidates") or []
    scores = [c.get("score") for c in cands]
    if ev.get("contract") != 2 or len(cands) != 50 or scores != sorted(scores, reverse=True):
        fail(f"contract 2 answered in the wrong shape: contract {ev.get('contract')}, {len(cands)} candidates")
    if not all(isinstance(c.get("taicol_id"), str) and c["taicol_id"].startswith("t") for c in cands):
        fail("contract 2 candidates are not keyed by TaiCOL id")
    if ev.get("modelVersion") != "bioclip2-vitl14-v2":
        fail(f"contract 2 answered from {ev.get('modelVersion')}, expected bioclip2-vitl14-v2")
    ok(f"contract 2: top-1 {cands[0]['taicol_id']} at {cands[0]['score']:.3f}, "
       f"{ev.get('speciesCount')} species scored")

    db = os.environ.get("DATABASE_URL")
    if not (db and args.expect):
        print("  (set DATABASE_URL and --expect to check the answers name the right animal)")
        return
    import psycopg

    want = " ".join(args.expect.split()[:2]).lower()
    with psycopg.connect(db) as conn, conn.cursor() as cur:
        cur.execute("select scientific_name from taxa where id = %s", (preds[0]["taxon_id"],))
        v1 = cur.fetchone()
        cur.execute("select scientific_name, taxon_status from taxa where taicol_id = %s", (cands[0]["taicol_id"],))
        v2 = cur.fetchone()
    got1 = " ".join((v1[0] if v1 else "").split()[:2]).lower()
    if got1 != want:
        fail(f"legacy top-1 is {v1[0] if v1 else 'not in this database'}, expected {args.expect} — "
             f"are the v1 ids from a different database?")
    ok(f"legacy top-1 resolves to {v1[0]}")
    if not v2 or v2[1] != "accepted" or " ".join(v2[0].split()[:2]).lower() != want:
        fail(f"contract 2 top-1 is {v2[0] if v2 else 'not in this database'}, expected {args.expect}")
    ok(f"contract 2 top-1 resolves to {v2[0]}, accepted")


if __name__ == "__main__":
    main()
