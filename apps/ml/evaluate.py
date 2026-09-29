"""Measure the classifier on labelled photographs, and fit what the website acts on.

    python apps/ml/evaluate.py --set live                 # one set, both contracts
    python apps/ml/evaluate.py --fit --write              # all three sets; refit and
                                                          # write the thresholds file
    python apps/ml/evaluate.py --contract 1 --category roadkill   # the legacy bands
    python apps/ml/evaluate.py --contract 1 --from-dump data/evalset/scores.json

THE SETS

  live       data/evalset: 308 iNaturalist photographs of live, well-framed
             animals, species chosen by how often TaiRON records them
             (scripts/build-evalset.ts). Fits the WILDLIFE profile.
  dead       data/evalset-dead: iNaturalist photographs annotated Dead, Taiwan,
             created after BioCLIP 2's training snapshot (build_inat_evalset.py).
             Fits the ROADKILL profile, which is what it exists for: every
             roadkill number before it was borrowed from live photographs.
  lookalike  data/evalset-lookalike: native animals the invasive page is likely
             to be shown, and the invasive species each is taken for. Measures
             the INVASIVE profile's gate.

SPECIES LEVEL. A prediction is right when it names the truth's species —
genus and epithet — whichever row carries it. The v1 label list holds deleted
names and subspecies beside their species, and scoring by row id counted 42 of
119 "misses" on the live set that named the right animal under another row.

WHAT IS FITTED, PER PROFILE (contract 2)

  high     The lowest score at which the model's species is right at least
           --target-precision of the time on the profile's own photographs.
           The team's rule is that the AI names a species by itself only where
           it is proven right at least 95% of the time. "Proven" is read
           strictly: the LOWER end of the 95% Wilson interval of the precision
           above the threshold must reach the target, not just the point
           estimate. The threshold is picked from the same photographs it is
           measured on, and a point estimate chosen that way sits at the target
           by construction; the interval is what says the target was cleared.
           When no threshold clears it, `high` is null and the profile only
           ever suggests.

  medium   Below this the top 5 is mostly wrong and is not shown. Fitted on
           LOCAL top-5 accuracy in equal-count bins (default 75%), walking up
           from the lowest scores, as before: a cumulative criterion stays
           above any sane target all the way down because overall top-5 is
           ~92%, and would say "never withhold the list" whatever the data.

The rules the website applies (apps/web/lib/report/classifyPolicy.ts) are
mirrored in `decide()` below, and the candidate lookup in `RESOLVE_SQL` is the
same query as apps/web/lib/report/classifyEvidence.ts. The thresholds are only
right if the two agree: change both.

READ THE NUMBERS CAREFULLY. Every set here is iNaturalist photography: framed
by someone who wanted a good picture. A reporter on a road is not that, and the
dead set is still an optimistic stand-in for roadkill. Small groups (crabs,
invasives) carry wide intervals, and they are printed.
"""

from __future__ import annotations

import argparse
import collections
import datetime as dt
import json
import math
import os
import pathlib
import sys
import time

import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).parent))

ROOT = pathlib.Path(__file__).resolve().parents[2]
THRESHOLDS_FILE = ROOT / "apps" / "web" / "lib" / "report" / "classifier-thresholds.json"

SETS = {
    "live": ROOT / "data" / "evalset",
    "dead": ROOT / "data" / "evalset-dead",
    "lookalike": ROOT / "data" / "evalset-lookalike",
}
# Which profile each set fits, and which stored category stands for it.
FITS = {"live": ("wildlife", "sighting"), "dead": ("roadkill", "roadkill"), "lookalike": ("invasive", "invasive")}

SHOWN = 5  # apps/web/lib/report/classifyPolicy.ts SHOWN

# Classes the model does not name by itself (classifier-thresholds.json
# neverAutoAssignClasses). Land crabs start here because they measured worst:
# the thresholds are fitted on the answers the model may actually give by
# itself, and write_thresholds() lifts a class only if it clears the bar.
NEVER_AUTO_ASSIGN = {"Malacostraca"}
AUTO_ASSIGN_CATEGORIES = {"roadkill", "injured", "sighting"}
PROFILE_OF_CATEGORY = {"roadkill": "roadkill", "injured": "roadkill", "sighting": "wildlife", "invasive": "invasive"}

# The worker's candidate lookup (lib/report/classifyEvidence.ts), verbatim in
# substance: accepted rows only, with the facts each profile's rule reads.
RESOLVE_SQL = """
select t.id, t.taicol_id, t.scientific_name, t.kingdom, t.class,
       t.is_invasive, t.is_marine, t.is_terrestrial,
       t.protected_status is not null as is_protected,
       exists (select 1 from taxa s
                where s.id in (select taxon_and_inheritors(t.taicol_id))
                  and s.id <> t.id
                  and s.is_invasive
                  and s.taxon_status = 'accepted') as has_invasive_infraspecific,
       exists (select 1 from reports r
                where r.taxon_id in (select taxon_and_inheritors(t.taicol_id))
                  and r.source = 'gbif'
                  and r.category in ('roadkill', 'injured')) as recorded_on_roads
  from taxa t
 where t.taicol_id = any(%s)
   and t.taxon_status = 'accepted'
"""


# ---------------------------------------------------------------------------
# Statistics
# ---------------------------------------------------------------------------

def wilson(k: int, n: int, z: float = 1.959964) -> tuple[float, float]:
    """95% Wilson score interval for k successes in n trials."""
    if n == 0:
        return (0.0, 1.0)
    p = k / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return (max(0.0, centre - half), min(1.0, centre + half))


def plain(o):
    """JSON for the numpy scalars the counting produces."""
    if isinstance(o, np.generic):
        return o.item()
    raise TypeError(f"{type(o).__name__} is not JSON serializable")


def pct(x: float) -> str:
    return f"{x:.1%}"


def ci(k: int, n: int) -> str:
    lo, hi = wilson(k, n)
    return f"{k}/{n} = {pct(k / n) if n else '—'} [{pct(lo)}, {pct(hi)}]"


# ---------------------------------------------------------------------------
# Data
# ---------------------------------------------------------------------------

def database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if url:
        return url
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("DATABASE_URL="):
                return line.split("=", 1)[1].strip()
    raise SystemExit("DATABASE_URL is not set")


def binomial(name: str | None) -> str:
    parts = (name or "").split()
    return " ".join(parts[:2]).lower()


def load_items(name: str, conn) -> list[dict]:
    """Every item as {key, path, truth (binomial), className, invasive, role}."""
    base = SETS[name]
    if name == "live":
        raw = [json.loads(l) for l in (base / "evalset.jsonl").read_text().splitlines() if l.strip()]
        ids = sorted({int(r["taxonId"]) for r in raw})
        with conn.cursor() as cur:
            cur.execute("select id, scientific_name, class, is_invasive, taicol_id from taxa where id = any(%s)", (ids,))
            by_id = {r[0]: r for r in cur.fetchall()}
        out = []
        for r in raw:
            t = by_id.get(int(r["taxonId"]))
            path = base / "images" / f"{r['gbifKey']}.jpg"
            if t is None or not path.exists():
                continue
            out.append({"key": str(r["gbifKey"]), "path": path, "truth": binomial(t[1]),
                        "name": t[1], "className": t[2], "invasive": bool(t[3]), "role": None,
                        "taicolId": t[4], "v1TaxonId": int(r["taxonId"])})
        return out

    manifest = base / "manifest.jsonl"
    if not manifest.exists():
        raise SystemExit(f"{manifest} missing — run build_inat_evalset.py {name}")
    out = []
    for line in manifest.read_text().splitlines():
        if not line.strip():
            continue
        r = json.loads(line)
        path = base / r["file"]
        if not path.exists():
            continue
        out.append({"key": str(r["photoId"]), "path": path, "truth": binomial(r["scientificName"]),
                    "name": r["scientificName"], "className": r.get("class"), "taicolId": r["taicolId"],
                    "invasive": bool(r.get("truthInvasive")), "role": r.get("role")})
    return out


def features(name: str, items: list[dict], clf) -> np.ndarray:
    """Image embeddings, cached beside the set: the model pass is the slow part."""
    detector = "md" if clf.detector else "nodet"
    cache = SETS[name] / f"features_{detector}.npz"
    have: dict[str, np.ndarray] = {}
    if cache.exists():
        z = np.load(cache, allow_pickle=False)
        have = dict(zip(z["keys"].tolist(), z["feats"]))
    todo = [it for it in items if it["key"] not in have]
    if todo:
        print(f"  embedding {len(todo)} {name} images (detector {'on' if clf.detector else 'off'})…", flush=True)
        t0 = time.time()
        for n, it in enumerate(todo, 1):
            feat, _ = clf.image_features(it["path"].read_bytes())
            have[it["key"]] = feat
            if n % 100 == 0:
                print(f"    {n}/{len(todo)}  {(time.time() - t0) / n:.2f}s/image", flush=True)
        keys = sorted(have)
        np.savez(cache, keys=np.array(keys), feats=np.stack([have[k] for k in keys]))
    return np.stack([have[it["key"]] for it in items])


# ---------------------------------------------------------------------------
# Contract 2: evidence, then the website's rules
# ---------------------------------------------------------------------------

def resolve(conn, taicols: set[str]) -> dict[str, dict]:
    with conn.cursor() as cur:
        cur.execute(RESOLVE_SQL, (sorted(taicols),))
        cols = [d.name for d in cur.description]
        return {r[1]: dict(zip(cols, r)) for r in cur.fetchall()}


def marine_only(c: dict) -> bool:
    return c["is_marine"] is True and c["is_terrestrial"] is not True


def may_be_named_as(profile: str, c: dict) -> bool:
    if c["kingdom"] != "Animalia":
        return False
    if profile == "roadkill":
        return (not marine_only(c)) or c["is_protected"] or c["recorded_on_roads"]
    return True


def pool_for(profile: str, evidence: list[dict], rows: dict[str, dict]) -> list[dict]:
    """Eligible candidates, most probable first, scores exactly as the model gave them."""
    pool = []
    for c in evidence:
        row = rows.get(c["taicol_id"])
        if row is not None and may_be_named_as(profile, row):
            pool.append({**row, "score": c["score"]})
    pool.sort(key=lambda r: (-r["score"], r["taicol_id"]))
    return pool


BLUR_SQL = """
select taicol_id, binomial_precision(id) as blur
  from taxa
 where taicol_id = any(%s)
   and taxon_status = 'accepted'
"""

PRECISION_RANK = {"exact": 0, "coarse_10km": 1, "coarse_50km": 2, "suppressed": 3}


def congener_guard(pool: list[dict], blur_of: dict) -> dict | None:
    """guardCongeners: a same-genus species on the shown list that is blurred
    more strictly than the top answer, which stops the model naming it."""
    if not pool:
        return None
    best = pool[0]
    genus = best["scientific_name"].split()[0].lower()
    own = PRECISION_RANK.get(blur_of.get(best["taicol_id"]) or "", 0)
    for c in pool[1:SHOWN]:
        if (c["scientific_name"].split()[0].lower() == genus
                and PRECISION_RANK.get(blur_of.get(c["taicol_id"]) or "", 0) > own):
            return c
    return None


def blurs(conn, taicols: set[str], cache: dict) -> dict:
    todo = sorted(taicols - cache.keys())
    if todo:
        with conn.cursor() as cur:
            cur.execute(BLUR_SQL, (todo,))
            cache.update(dict(cur.fetchall()))
        for t in todo:
            cache.setdefault(t, None)
    return cache


def invasive_verdict(best: dict | None) -> str | None:
    if best is None:
        return None
    if best["is_invasive"]:
        return "suspected"
    if best["has_invasive_infraspecific"]:
        return "mixed"
    return "native"


# ---------------------------------------------------------------------------
# Fitting
# ---------------------------------------------------------------------------

def fit_high(scores: np.ndarray, hit1: np.ndarray, target: float, min_n: int = 30,
             total: int | None = None) -> dict:
    """The lowest threshold whose precision's Wilson lower bound reaches `target`.

    Also reports the point-estimate fit, for comparison, so the cost of reading
    "proven" strictly is visible in the numbers rather than asserted.

    `scores`/`hit1` are the photographs the model could name by itself; `total`
    is every photograph, so coverage is the share of all reports named. The
    threshold is stored unrounded: rounding it up or down moves a photograph
    across it and changes the precision it was fitted at.
    """
    order = np.argsort(-scores)
    s, h = scores[order], hit1[order]
    k = np.cumsum(h)
    n = np.arange(1, len(s) + 1)
    lows = np.array([wilson(int(a), int(b))[0] for a, b in zip(k, n)])
    point = k / n

    def at(i: int | None) -> dict | None:
        if i is None:
            return None
        # All images tied at the threshold score are in; step to the last of them.
        thr = float(s[i])
        j = int(np.where(s >= thr)[0][-1])
        lo, hi = wilson(int(k[j]), int(n[j]))
        return {"threshold": thr, "n": int(n[j]), "right": int(k[j]),
                "precision": round(float(point[j]), 4), "wilson95": [round(lo, 4), round(hi, 4)],
                "coverage": round(float(n[j] / (total or len(s))), 4)}

    strict = [i for i in range(len(s)) if n[i] >= min_n and lows[i] >= target]
    loose = [i for i in range(len(s)) if n[i] >= min_n and point[i] >= target]
    return {"strict": at(strict[-1] if strict else None), "pointEstimate": at(loose[-1] if loose else None)}


def fit_medium(scores: np.ndarray, hit5: np.ndarray, target: float, bin_size: int) -> float | None:
    asc = np.argsort(scores)
    s, h = scores[asc], hit5[asc]
    for i in range(0, len(s), bin_size):
        chunk = h[i: i + bin_size]
        if len(chunk) >= bin_size // 2 and chunk.mean() >= target:
            return float(s[i])
    return None


def band_of(score: float, high: float | None, medium: float) -> str:
    if high is not None and score >= high:
        return "high"
    return "medium" if score >= medium else "low"


def band_table(scores, hit1, hit5, high, medium) -> dict:
    out = {}
    for b in ("high", "medium", "low"):
        m = np.array([band_of(x, high, medium) == b for x in scores])
        n = int(m.sum())
        out[b] = {"n": n, "share": round(n / len(scores), 4) if len(scores) else 0,
                  "top1": round(float(hit1[m].mean()), 4) if n else None,
                  "top5": round(float(hit5[m].mean()), 4) if n else None,
                  "top1Wilson95": [round(x, 4) for x in wilson(int(hit1[m].sum()), n)] if n else None}
    return out


def print_bands(title: str, table: dict) -> None:
    print(f"    {title}")
    for b, r in table.items():
        if r["n"] == 0:
            print(f"      {b:7} n=   0")
            continue
        lo, hi = r["top1Wilson95"]
        print(f"      {b:7} n={r['n']:4} share {pct(r['share']):>6}  top-1 {pct(r['top1']):>6} "
              f"[{pct(lo)}, {pct(hi)}]  top-5 {pct(r['top5']):>6}")


# ---------------------------------------------------------------------------
# One set, both contracts
# ---------------------------------------------------------------------------

def evaluate_set(name: str, clf, conn, args) -> dict:
    from contract import evidence as evidence_of
    from pipeline import BAND_HIGH, BAND_MEDIUM

    items = load_items(name, conn)
    if args.limit:
        items = items[: args.limit]
    profile, category = FITS[name]
    print(f"\n=== {name}: {len(items)} photographs of {len({i['truth'] for i in items})} species "
          f"-> {profile} profile ===", flush=True)
    feats = features(name, items, clf)
    truth = [it["truth"] for it in items]
    result: dict = {"set": name, "profile": profile, "n": len(items),
                    "species": len({i["truth"] for i in items})}

    # ---- contract 1, as deployed today -------------------------------------
    legacy = clf.legacy_set()
    with conn.cursor() as cur:
        cur.execute("select id, scientific_name from taxa where id = any(%s)", (legacy.ids.tolist(),))
        v1_name = {r[0]: binomial(r[1]) for r in cur.fetchall()}
    v1 = {}
    for cat in ("roadkill", "sighting"):
        mask = legacy.labels.for_category(cat)
        emb = legacy.emb if mask is None else legacy.emb[mask]
        ids = legacy.ids if mask is None else legacy.ids[mask]
        sc, h1, h5 = [], [], []
        for f, t in zip(feats, truth):
            z = clf.scale * (emb @ f)
            z = z - z.max()
            p = np.exp(z)
            p /= p.sum()
            top = np.argsort(-p)[:5]
            names = [v1_name.get(int(ids[j]), "") for j in top]
            sc.append(float(p[top[0]]))
            h1.append(names[0] == t)
            h5.append(t in names)
        sc, h1, h5 = np.array(sc), np.array(h1), np.array(h5)
        table = band_table(sc, h1, h5, BAND_HIGH, BAND_MEDIUM)
        v1[cat] = {"top1": round(float(h1.mean()), 4), "top5": round(float(h5.mean()), 4), "bands": table}
        print(f"\n  contract 1 (v1 files, category {cat!r} list, bands {BAND_HIGH}/{BAND_MEDIUM}), species level:")
        print(f"    top-1 {ci(int(h1.sum()), len(h1))}   top-5 {pct(h5.mean())}")
        print_bands("bands:", table)
    result["contract1"] = v1

    # The legacy invasive list, on the look-alike natives: how often a native
    # animal came back as an invasive species, in the band that published it.
    if name in ("lookalike", "live"):
        mask = legacy.labels.for_category("invasive")
        emb = legacy.emb[mask]
        natives = [i for i, it in enumerate(items) if not it["invasive"]]
        hi = 0
        for i in natives:
            z = clf.scale * (emb @ feats[i])
            z = z - z.max()
            p = np.exp(z)
            p /= p.sum()
            hi += float(p.max()) >= BAND_HIGH
        result["contract1InvasiveListNativesHigh"] = {"n": len(natives), "k": int(hi)}
        print(f"\n  contract 1 invasive list: natives named invasive in the HIGH band: {ci(hi, len(natives))}")

    # ---- contract 2: evidence, then the website's rules ----------------------
    ev = [evidence_of(clf.scale * (clf.evidence_set().emb @ f), clf.evidence_set().index) for f in feats]
    rows = resolve(conn, {c["taicol_id"] for e in ev for c in e})
    pools = [pool_for(profile, e, rows) for e in ev]
    sc = np.array([p[0]["score"] if p else 0.0 for p in pools])
    h1 = np.array([bool(p) and binomial(p[0]["scientific_name"]) == t for p, t in zip(pools, truth)])
    h5 = np.array([t in [binomial(c["scientific_name"]) for c in p[:SHOWN]] for p, t in zip(pools, truth)])
    # How deep in the 50 the fifth eligible answer sat: the margin TOP_N leaves.
    depth = []
    for e, p in zip(ev, pools):
        if len(p) >= SHOWN:
            fifth = p[SHOWN - 1]["taicol_id"]
            depth.append(next(i for i, c in enumerate(e) if c["taicol_id"] == fifth) + 1)
    result["contract2"] = {"top1": round(float(h1.mean()), 4), "top5": round(float(h5.mean()), 4),
                           "top1Wilson95": [round(x, 4) for x in wilson(int(h1.sum()), len(h1))],
                           "fifthEligibleDepthMax": int(max(depth)) if depth else None,
                           "fewerThanFiveEligible": int(sum(1 for p in pools if len(p) < SHOWN))}
    print(f"\n  contract 2 (v2 files, {profile} profile), species level:")
    print(f"    top-1 {ci(int(h1.sum()), len(h1))}   top-5 {pct(h5.mean())}")
    print(f"    the fifth answer this profile may give sat at most {result['contract2']['fifthEligibleDepthMax']} "
          f"deep in the top 50; {result['contract2']['fewerThanFiveEligible']} photos had fewer than 5 eligible")

    # What the fit is over. `mine`: photographs whose true species this rule
    # set may be named as at all — the photographs a report of this kind could
    # be of. The dead set is every dead vertebrate on iNaturalist, so it holds
    # fish from beaches that no roadkill report will show and the roadkill set
    # can never name; counting them would measure the wrong population. They
    # are still in every "all photographs" number above. `assignable`: the
    # model's answer is in a class it may name by itself (no crabs), because
    # the threshold is about the answers it gives without a person.
    truth_rows = resolve(conn, {it["taicolId"] for it in items if it.get("taicolId")})
    mine = np.array([
        (it.get("taicolId") not in truth_rows) or may_be_named_as(profile, truth_rows[it["taicolId"]])
        for it in items
    ])
    # Mirrors decideFromEvidence: never crabs, and never an answer that says
    # "invasive" (a person confirms those on every page).
    # And guardCongeners: no stricter-blurred congener on the shown list. The
    # blur lookup is slow (binomial_precision scans taxa by name), so it is
    # asked only for photos whose top answer is above 0.5, far below any
    # threshold a strict fit can reach; below that the guard is moot.
    cache: dict = {}
    near = [i for i, p in enumerate(pools) if p and p[0]["score"] >= 0.5]
    blurs(conn, {c["taicol_id"] for i in near for c in pools[i][:SHOWN]}, cache)
    guarded = np.array([bool(p) and p[0]["score"] >= 0.5 and congener_guard(p, cache) is not None
                        for p in pools])
    assignable = np.array([
        bool(p) and (p[0]["class"] not in NEVER_AUTO_ASSIGN)
        and not (p[0]["is_invasive"] or p[0]["has_invasive_infraspecific"])
        for p in pools
    ]) & ~guarded
    result["guardedByCongener"] = int(guarded.sum())
    fit = mine & assignable
    result["fitPopulation"] = {"photos": int(mine.sum()), "assignable": int(fit.sum()),
                               "outsideProfile": int((~mine).sum())}
    print(f"    fitted on the {int(mine.sum())} photos whose species this rule set may name "
          f"({int((~mine).sum())} are of animals it never names); "
          f"{int(fit.sum())} have an answer the model may give by itself "
          f"({int(guarded.sum())} held back by a stricter congener on the list)")
    k1, k5 = int(h1[mine].sum()), int(h5[mine].sum())
    result["contract2"]["mine"] = {"n": int(mine.sum()), "top1": k1, "top5": k5,
                                   "top1Wilson95": [round(x, 4) for x in wilson(k1, int(mine.sum()))]}
    print(f"    on those: top-1 {ci(k1, int(mine.sum()))}   top-5 {pct(k5 / max(int(mine.sum()), 1))}")

    high = fit_high(sc[fit], h1[fit], args.target_precision, total=int(mine.sum()))
    medium = fit_medium(sc[mine], h5[mine], args.target_top5, args.bin)
    result["fit"] = {"high": high, "medium": medium}
    strict = high["strict"]
    print(f"\n    fit on this set (target {pct(args.target_precision)}):")
    for label, f in (("strict (Wilson lower bound)", strict), ("point estimate", high["pointEstimate"])):
        if f:
            print(f"      {label:28} threshold {f['threshold']:.3f}  precision {ci(f['right'], f['n'])}  "
                  f"coverage {pct(f['coverage'])}")
        else:
            print(f"      {label:28} no threshold reaches it")
    print(f"      medium (local top-5 >= {pct(args.target_top5)}): {medium if medium is None else round(medium, 3)}")
    table = band_table(sc[mine], h1[mine], h5[mine], strict["threshold"] if strict else None,
                       medium if medium is not None else 1.1)
    result["contract2"]["bands"] = table
    print_bands("bands with these cutoffs (photos this rule set is for):", table)

    # What a wrong name the model gives by itself would do to a location. Each
    # species named is blurred at its binomial's strictest (0014); if the true
    # animal needs more than the named one gets, that mistake publishes it
    # less blurred than its rating asks.
    if strict:
        named = [i for i in range(len(items))
                 if fit[i] and sc[i] >= strict["threshold"] and not h1[i]]
        tais = {items[i]["taicolId"] for i in named} | {pools[i][0]["taicol_id"] for i in named}
        with conn.cursor() as cur:
            cur.execute("select taicol_id, binomial_precision(id) from taxa where taicol_id = any(%s)",
                        (sorted(tais),))
            prec = dict(cur.fetchall())
        rank = {None: 0, "exact": 0, "coarse_10km": 1, "coarse_50km": 2, "suppressed": 3}
        wrong = []
        for i in named:
            t, g = prec.get(items[i]["taicolId"]), prec.get(pools[i][0]["taicol_id"])
            wrong.append({"truth": items[i]["name"], "named": pools[i][0]["scientific_name"],
                          "score": round(float(sc[i]), 4), "truthBlur": t, "namedBlur": g,
                          "looser": rank.get(g, 0) < rank.get(t, 0)})
        result["wrongNamed"] = wrong
        print(f"    named by the model and wrong: {len(wrong)}; "
              f"published less blurred than the true animal needs: {sum(w['looser'] for w in wrong)}")
        for w in wrong:
            print(f"      {w['truth']} named {w['named']} at {w['score']}  "
                  f"blur {w['namedBlur']} vs needed {w['truthBlur']}{'  LOOSER' if w['looser'] else ''}")

    # Held out: fit on one half of the photographs, measure on the other, both
    # ways round. The threshold above is chosen on the same photographs it is
    # measured on; this says how much of its precision survives new ones.
    # The halves split by species, so no species is on both sides. Half a set
    # rarely has enough photographs for the strict criterion, so the
    # point-estimate fit is held out too: it shows how optimistic a threshold
    # picked on its own photographs is.
    species = sorted({t for t in truth})
    half = {sp: i % 2 for i, sp in enumerate(species)}
    side = np.array([half[t] for t in truth])
    holdout = []
    for criterion in ("strict", "pointEstimate"):
        for a in (0, 1):
            fit_on, test_on = fit & (side == a), fit & (side != a)
            f = fit_high(sc[fit_on], h1[fit_on], args.target_precision)[criterion]
            if f is None:
                holdout.append({"criterion": criterion, "fitHalf": a, "threshold": None})
                print(f"    held out, {criterion} fit on half {a}: nothing reaches the target on {int(fit_on.sum())} photos")
                continue
            m = test_on & (sc >= f["threshold"])
            k, n = int(h1[m].sum()), int(m.sum())
            lo, hi = wilson(k, n)
            holdout.append({"criterion": criterion, "fitHalf": a, "threshold": f["threshold"],
                            "inSample": f["precision"], "n": n, "right": k,
                            "precision": round(k / n, 4) if n else None, "wilson95": [round(lo, 4), round(hi, 4)]})
            print(f"    held out, {criterion} fit on half {a} (threshold {f['threshold']:.3f}, "
                  f"{pct(f['precision'])} in sample): other half {ci(k, n)}")
    result["holdout"] = holdout

    # ---- per class, and crabs on their own ---------------------------------
    by_class = collections.defaultdict(list)
    for i, it in enumerate(items):
        by_class[it["className"] or "?"].append(i)
    result["byClass"] = {}
    print("\n    by class (contract 2):")
    for cls in sorted(by_class, key=lambda c: -len(by_class[c])):
        idx = by_class[cls]
        k1, k5 = int(h1[idx].sum()), int(h5[idx].sum())
        result["byClass"][cls] = {"n": len(idx), "top1": k1, "top5": k5}
        print(f"      {cls:14} n={len(idx):4}  top-1 {ci(k1, len(idx)):32} top-5 {pct(k5 / len(idx))}")

    # ---- the invasive gate ---------------------------------------------------
    if name in ("lookalike", "live"):
        inv_pools = pools if profile == "invasive" else [pool_for("invasive", e, rows) for e in ev]
        inv_sc = np.array([p[0]["score"] if p else 0.0 for p in inv_pools])
        verdicts = [invasive_verdict(p[0] if p else None) for p in inv_pools]
        natives = [i for i, it in enumerate(items) if not it["invasive"]]
        invasives = [i for i, it in enumerate(items) if it["invasive"]]
        med = medium if (profile == "invasive" and medium is not None) else 0.0
        gate = {
            "natives": len(natives),
            "nativeSuspected": sum(verdicts[i] == "suspected" for i in natives),
            "nativeSuspectedOrMixed": sum(verdicts[i] in ("suspected", "mixed") for i in natives),
            "nativeSuspectedShown": sum(verdicts[i] == "suspected" and inv_sc[i] >= med for i in natives),
            "invasives": len(invasives),
            "invasiveSuspected": sum(verdicts[i] == "suspected" for i in invasives),
            "invasiveSuspectedOrMixed": sum(verdicts[i] in ("suspected", "mixed") for i in invasives),
            "invasiveRightSpecies": sum(
                bool(inv_pools[i]) and binomial(inv_pools[i][0]["scientific_name"]) == items[i]["truth"]
                for i in invasives),
        }
        result["gate"] = gate
        fp = [(items[i]["name"], inv_pools[i][0]["scientific_name"], round(float(inv_sc[i]), 3))
              for i in natives if verdicts[i] == "suspected"]
        result["gate"]["nativeSuspectedExamples"] = fp[:20]
        print("\n    invasive gate (all animals, suspected only when the top answer is itself invasive):")
        print(f"      natives called suspected invasive       {ci(gate['nativeSuspected'], gate['natives'])}")
        print(f"      ... or 'mixed' (an invasive subspecies)  {ci(gate['nativeSuspectedOrMixed'], gate['natives'])}")
        print(f"      invasives called suspected invasive     {ci(gate['invasiveSuspected'], gate['invasives'])}")
        print(f"      ... or 'mixed'                          {ci(gate['invasiveSuspectedOrMixed'], gate['invasives'])}")
        for x in fp[:20]:
            print(f"        native {x[0]} -> {x[1]} {x[2]}")

    return result


# ---------------------------------------------------------------------------
# Contract 1 band fitting, kept as it was
# ---------------------------------------------------------------------------

def legacy_report(records, scored, args) -> None:
    arr = sorted(records, key=lambda r: -r[0])
    scores = np.array([r[0] for r in arr])
    hit1 = np.array([r[1] for r in arr], dtype=float)
    hit5 = np.array([r[2] for r in arr], dtype=float)
    cum = np.cumsum(hit1) / np.arange(1, len(arr) + 1)
    ok = np.where(cum >= args.target_precision)[0]
    if len(ok):
        hi = int(ok[-1])
        print(f"\n  BAND_HIGH (cumulative top-1 >= {pct(args.target_precision)}): {scores[hi]:.3f}, "
              f"precision {pct(cum[hi])}, coverage {pct((hi + 1) / scored)}")
    else:
        print(f"\n  BAND_HIGH: nothing reaches {pct(args.target_precision)}")
    med = fit_medium(scores, hit5, args.target_top5, args.bin)
    print(f"  BAND_MEDIUM (local top-5 >= {pct(args.target_top5)}): {med}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--set", choices=sorted(SETS), action="append")
    ap.add_argument("--fit", action="store_true", help="evaluate every set that exists")
    ap.add_argument("--write", action="store_true", help=f"write {THRESHOLDS_FILE.relative_to(ROOT)}")
    ap.add_argument("--contract", type=int, choices=[1, 2], default=2)
    ap.add_argument("--category", default="roadkill", help="contract 1 only")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--target-precision", type=float, default=0.95)
    ap.add_argument("--target-top5", type=float, default=0.75)
    ap.add_argument("--bin", type=int, default=25)
    ap.add_argument("--from-dump", type=pathlib.Path, default=None,
                    help="contract 1: refit the legacy bands from a previous per-image dump")
    ap.add_argument("--out", type=pathlib.Path, default=None, help="write the full measurements as JSON here")
    ap.add_argument("--from-results", type=pathlib.Path, default=None,
                    help="with --write: write the thresholds from a previous --out file, with no model pass")
    args = ap.parse_args()

    if args.from_results:
        write_thresholds(json.loads(args.from_results.read_text()), args)
        return

    if args.contract == 1 and args.from_dump:
        rows = json.loads(args.from_dump.read_text())
        legacy_report([(r["score"], r["top1"], r["top5"]) for r in rows], len(rows), args)
        return

    import psycopg

    from pipeline import Classifier

    sets = sorted(SETS) if args.fit else (args.set or ["live"])
    sets = [s for s in sets if s == "live" or (SETS[s] / "manifest.jsonl").exists()]
    print("Loading the model…", flush=True)
    clf = Classifier()
    results = {}
    with psycopg.connect(database_url()) as conn:
        for s in sets:
            results[s] = evaluate_set(s, clf, conn, args)

    if args.out:
        args.out.write_text(json.dumps(results, indent=1, default=plain) + "\n")
    if args.write:
        write_thresholds(results, args)


def invasive_entry(entry: dict, live_medium: float, lookalike_medium: float | None) -> dict:
    # Its bands were tabled at the look-alike set's own medium, which is not
    # the one used; keep them under a name that says so.
    out = {**entry, "medium": live_medium, "mediumFittedOn": "live", "mediumOnLookalike": lookalike_medium}
    out["bandsAtLookalikeMedium"] = out.pop("bands")
    return out


def write_thresholds(results: dict, args) -> None:
    from bioclip import MODEL_VERSION

    missing = [s for s in ("live", "dead", "lookalike") if s not in results]
    if missing:
        raise SystemExit(f"--write needs every set; missing {missing}")

    def profile_entry(res: dict, auto_assign_allowed: bool) -> dict:
        strict = res["fit"]["high"]["strict"]
        medium = res["fit"]["medium"]
        return {
            "high": strict["threshold"] if strict else None,
            "medium": round(medium, 4) if medium is not None else 1.0,
            "autoAssign": bool(auto_assign_allowed and strict),
            "fittedOn": res["set"],
            "photos": res["n"],
            "species": res["species"],
            "fitPopulation": res["fitPopulation"],
            "highFit": strict,
            "highFitPointEstimate": res["fit"]["high"]["pointEstimate"],
            "highHeldOut": res["holdout"],
            "top1": res["contract2"]["top1"],
            "top1Wilson95": res["contract2"]["top1Wilson95"],
            "top5": res["contract2"]["top5"],
            "bands": res["contract2"]["bands"],
        }

    crabs = {s: results[s]["byClass"].get("Malacostraca") for s in results}
    crab_n = sum(c["n"] for c in crabs.values() if c)
    crab_k = sum(c["top1"] for c in crabs.values() if c)
    crab_lo, crab_hi = wilson(crab_k, crab_n)
    # Never auto-assign crabs unless they clear the same bar as everything else.
    never = sorted(NEVER_AUTO_ASSIGN - ({"Malacostraca"} if crab_n and crab_lo >= args.target_precision else set()))

    out = {
        "_comment": (
            "Written by apps/ml/evaluate.py --fit --write. Do not edit by hand: re-run it. "
            "What each number means is documented there and in apps/web/lib/report/classifyPolicy.ts; "
            "the story is in docs/ai-rollout.md."
        ),
        "modelVersion": MODEL_VERSION,
        "fittedAt": dt.date.today().isoformat(),
        "targetPrecision": args.target_precision,
        "criterion": "high = lowest score whose precision's 95% Wilson lower bound reaches targetPrecision "
                     "(at least 30 photos above it); medium = lowest equal-count bin whose local top-5 "
                     f"reaches {args.target_top5}; species level (binomial)",
        "profiles": {
            "wildlife": profile_entry(results["live"], True),
            "roadkill": profile_entry(results["dead"], True),
            # The look-alike set measures the gate, not the list: it is 33
            # well-photographed species picked for being confused with each
            # other, and its lowest-scoring bin already has the right answer in
            # the top 5 three times in four, which would fit `medium` near zero
            # and show every list. The invasive rule set scores the same
            # candidates as the wildlife one, so it shows a list on the same
            # evidence, fitted on the live set.
            "invasive": invasive_entry(profile_entry(results["lookalike"], False),
                                       profile_entry(results["live"], False)["medium"],
                                       results["lookalike"]["fit"]["medium"]),
        },
        "neverAutoAssignClasses": never,
        "crabs": {"photos": crab_n, "top1": crab_k, "top1Wilson95": [round(crab_lo, 4), round(crab_hi, 4)],
                  "bySet": crabs},
        "invasiveGate": {s: results[s].get("gate") for s in ("live", "lookalike")},
        "contract1": {s: results[s]["contract1"] for s in results},
    }
    THRESHOLDS_FILE.write_text(json.dumps(out, ensure_ascii=False, indent=2, default=plain) + "\n")
    print(f"\n  wrote {THRESHOLDS_FILE.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
