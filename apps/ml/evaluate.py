"""Measure classifier accuracy against the labelled eval set, and fit the
confidence bands.

    python apps/ml/evaluate.py [--limit N] [--category roadkill]

Raw cosine similarity is not a probability and softmax over a restricted set is
still overconfident, so the high/medium/low cutoffs in pipeline.py cannot be
chosen from theory. This script fits both cutoffs, and they are fitted against
**different criteria**, because the two bands do different jobs:

  BAND_HIGH   auto-assigns a species with no human in the loop, so it is fitted
              on top-1 precision (default target 90%). A wrong auto-assignment
              is a wrong record in a scientific dataset.

  BAND_MEDIUM decides whether to show the user a top-5 list and ask them to
              pick. That is worth doing only when the right answer is actually
              in the list, so it is fitted on top-5 accuracy (default target
              75%) — not top-1. Below it, the list is mostly wrong, and offering
              it wastes the reporter's time and risks anchoring them on a
              plausible-looking mistake.

              It is fitted on a **local** estimate, not a cumulative one. The
              cumulative curve answers "if we accepted everything down to here,
              how good is the average?" — and because overall top-5 is ~92%, that
              average stays above any sane target all the way to the lowest score
              in the set, which would say "never withhold the list" no matter what
              the data looked like down there. The question that matters is local:
              for images scoring *around* this value, is the answer in the list?
              So scores are walked in equal-count bins and the cutoff is the
              lowest bin that still meets the target.

Fitting BAND_MEDIUM on precision, as if it were a weaker BAND_HIGH, would be a
category error: nothing is auto-assigned in that band.

READ THE NUMBERS CAREFULLY. The eval images come from iNaturalist: live,
well-framed animals. Real roadkill is dead, often damaged, frequently distant and
against asphalt. These figures are an **optimistic upper bound** for the roadkill
category — they answer "can the model tell Taiwan species apart", not "is it ready
for roadkill photos".
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
import time

import numpy as np
import requests

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from pipeline import Classifier  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[2]
EVAL_FILE = ROOT / "data" / "evalset" / "evalset.jsonl"
IMAGE_DIR = ROOT / "data" / "evalset" / "images"


def fetch(url: str, dest: pathlib.Path) -> bytes | None:
    if dest.exists():
        return dest.read_bytes()
    try:
        r = requests.get(url, timeout=45, headers={"user-agent": "conservation-tw/0.1 (eval)"})
        if r.status_code != 200 or not r.content:
            return None
        dest.write_bytes(r.content)
        return r.content
    except Exception:
        return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--category", default="roadkill")
    ap.add_argument("--target-precision", type=float, default=0.90,
                    help="top-1 precision target that fits BAND_HIGH")
    ap.add_argument("--target-top5", type=float, default=0.75,
                    help="top-5 accuracy target that fits BAND_MEDIUM")
    ap.add_argument("--dump", type=pathlib.Path, default=None,
                    help="write per-image scores here so bands can be refitted without re-running the model")
    ap.add_argument("--from-dump", type=pathlib.Path, default=None,
                    help="refit the bands from a previous --dump, with no model pass at all")
    ap.add_argument("--bin", type=int, default=25,
                    help="images per bin for the local top-5 estimate that fits BAND_MEDIUM")
    args = ap.parse_args()

    if args.from_dump:
        rows = json.loads(args.from_dump.read_text())
        recs = [(r["score"], r["top1"], r["top5"]) for r in rows]
        print(f"Refitting bands from {args.from_dump} ({len(recs)} images, no model run)\n")
        report(recs, len(recs), args)
        return

    if not EVAL_FILE.exists():
        raise SystemExit(f"{EVAL_FILE} missing — run `npm run build:evalset` first")

    items = [json.loads(l) for l in EVAL_FILE.read_text().splitlines() if l.strip()]
    if args.limit:
        items = items[: args.limit]
    IMAGE_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Loading classifier…")
    clf = Classifier()
    print(f"  {clf.emb.shape[0]:,} candidate taxa, detector={'on' if clf.detector else 'off'}")
    print(f"Evaluating {len(items)} images as category={args.category!r}\n")

    top1 = top5 = scored = failed = 0
    records: list[tuple[float, bool, bool]] = []  # (top-1 score, top-1 hit, top-5 hit)
    t0 = time.time()

    for i, item in enumerate(items, 1):
        dest = IMAGE_DIR / f"{item['gbifKey']}.jpg"
        blob = fetch(item["imageUrl"], dest)
        if not blob:
            failed += 1
            continue
        try:
            res = clf.classify(blob, args.category)
        except Exception as e:
            failed += 1
            print(f"  ! {item['scientificName']}: {e}")
            continue

        truth = int(item["taxonId"])  # tolerate JSON that encoded the id as a string
        ids = [p.taxon_id for p in res.predictions]
        hit1 = bool(ids and ids[0] == truth)
        hit5 = truth in ids
        top1 += hit1
        top5 += hit5
        scored += 1
        records.append((res.predictions[0].score if res.predictions else 0.0, hit1, hit5))

        if i % 25 == 0 or i == len(items):
            print(f"  {i}/{len(items)}  top1={top1/max(scored,1):.1%}  top5={top5/max(scored,1):.1%}")

    if scored == 0:
        raise SystemExit("Nothing scored — could not download any eval images.")

    elapsed = time.time() - t0
    print(
        f"\n=== Results ({scored} scored, {failed} unusable, {elapsed/scored:.2f}s/image) ===\n"
        f"  top-1 accuracy  {top1/scored:.1%}\n"
        f"  top-5 accuracy  {top5/scored:.1%}"
    )

    if args.dump:
        args.dump.parent.mkdir(parents=True, exist_ok=True)
        args.dump.write_text(json.dumps(
            [{"score": r[0], "top1": r[1], "top5": r[2]} for r in records], indent=1))
        print(f"\n  per-image scores -> {args.dump}")

    report(records, scored, args)


def report(records, scored, args) -> None:
    # Sort by descending score once. The BAND_HIGH fit is a cumulative statistic
    # over that ordering; the BAND_MEDIUM fit deliberately is not (see docstring).
    arr = sorted(records, key=lambda r: -r[0])
    scores = np.array([r[0] for r in arr])
    hit1 = np.array([r[1] for r in arr], dtype=float)
    hit5 = np.array([r[2] for r in arr], dtype=float)
    cum_prec = np.cumsum(hit1) / np.arange(1, len(arr) + 1)

    ok = np.where(cum_prec >= args.target_precision)[0]
    hi = int(ok[-1]) if len(ok) else None
    if hi is not None:
        print(
            f"\n  BAND_HIGH — fitted on cumulative top-1 precision >= {args.target_precision:.0%}\n"
            f"    threshold     {scores[hi]:.3f}\n"
            f"    precision     {cum_prec[hi]:.1%}\n"
            f"    coverage      {(hi+1)/scored:.1%} auto-identified\n"
            f"    -> BAND_HIGH = {scores[hi]:.2f}"
        )
    else:
        print(
            f"\n  BAND_HIGH — no threshold reaches {args.target_precision:.0%} top-1 precision"
            f"\n    best observed: {cum_prec.max():.1%}"
            f"\n    -> auto-identification is not safe; route everything to human review."
        )

    # Local top-5 by equal-count bin, walking from the lowest scores upward.
    asc = np.argsort(scores)
    s_asc, h5_asc = scores[asc], hit5[asc]
    print(f"\n  Local top-5 by score bin ({args.bin} images per bin):")
    print(f"    {'score range':>16} {'n':>4} {'top-5':>7}")
    med = None
    for i in range(0, len(s_asc), args.bin):
        chunk5 = h5_asc[i : i + args.bin]
        lo, hi_s = s_asc[i], s_asc[min(i + args.bin, len(s_asc)) - 1]
        acc = chunk5.mean()
        flag = ""
        if med is None and acc >= args.target_top5 and len(chunk5) >= args.bin // 2:
            med = float(lo)
            flag = "  <- BAND_MEDIUM"
        print(f"    [{lo:.3f},{hi_s:.3f}] {len(chunk5):4} {acc:6.1%}{flag}")

    if med is not None:
        print(f"\n  BAND_MEDIUM — lowest bin whose local top-5 >= {args.target_top5:.0%}")
        print(f"    -> BAND_MEDIUM = {med:.2f}")
        below = s_asc < med
        if below.sum():
            print(f"    below it: {int(below.sum())} images ({below.mean():.1%}), local top-5 {h5_asc[below].mean():.1%}")
            print(f"    NOTE: that is a small sample — treat the exact cutoff as provisional.")
        else:
            print("    no image in the set falls below it")
    else:
        print(f"\n  BAND_MEDIUM — no bin reaches {args.target_top5:.0%} local top-5")

    # What a reporter in each band actually experiences.
    if hi is not None and med is not None:
        b_hi = scores[hi]
        print(f"\n  Per-band behaviour (high >= {b_hi:.2f}, medium >= {med:.2f}):")
        print(f"    {'band':8} {'n':>5} {'share':>7} {'top-1':>7} {'top-5':>7}")
        for name, mask in [
            ("high", scores >= b_hi),
            ("medium", (scores < b_hi) & (scores >= med)),
            ("low", scores < med),
        ]:
            k = int(mask.sum())
            if k == 0:
                print(f"    {name:8} {0:5}       —       —       —")
            else:
                print(f"    {name:8} {k:5} {k/scored:6.1%} {hit1[mask].mean():6.1%} {hit5[mask].mean():6.1%}")


if __name__ == "__main__":
    main()
