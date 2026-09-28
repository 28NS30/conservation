"""Build the dead-animal and native look-alike evaluation sets from iNaturalist.

    python apps/ml/build_inat_evalset.py dead
    python apps/ml/build_inat_evalset.py lookalike

FOR TESTING ONLY. These photographs measure the classifier; they are never used
to train anything, never shown on the site, and never committed. The team
approved downloading them on that basis, credited, with every photograph's
attribution stored beside it (docs/ai-rollout.md). `data/` is
gitignored; the manifests, the images and the credits stay on the machine that
built them.

WHY THESE TWO SETS. Every threshold the classifier used before this was fitted
on 308 live, well-framed iNaturalist photographs (data/evalset). A roadkill
report is a photograph of a dead, often damaged animal, and nobody has
published how BioCLIP does on those — so the roadkill profile's thresholds were
a guess borrowed from a different kind of picture. And the invasive page's one
measured failure is look-alikes: a native 布氏樹蛙 taken for the invasive 斑腿樹蛙,
a native 八哥 (protected, class II) for the invasive 白尾八哥. So:

  dead       iNaturalist, Taiwan (place 7887), research grade, annotated
             "Alive or Dead" = Dead (term 17, value 19), with photos, created
             after 2024-06-01 — after BioCLIP 2's May 2024 training snapshot,
             so the model cannot have seen them — vertebrates plus Malacostraca
             (land crabs are 6% of TaiRON's records), at most --per-species
             photographs of each species.

  lookalike  The same place, grade, date and licences, NOT annotated dead: the
             native animals the invasive page is most likely to be shown, and
             the invasive species each is mistaken for. The natives measure
             the invasive gate's false positives; the invasives measure what
             the gate still catches.

LICENCES. Only photographs licensed CC0, CC BY or CC BY-NC, checked per photo
rather than per observation, because an observer can license the two
differently. The attribution string iNaturalist publishes for the photo is
stored verbatim with the observer's login and the observation's URL.

POLITENESS. At most one request a second, API and image downloads alike, with a
User-Agent that says what this is. iNaturalist's published guidance could not be
read when this was written (its page answered 403), so the pace is a
conservative choice rather than a documented limit.

No coordinates are read or stored. A dead animal's location is exactly the kind
of thing this project blurs, and the evaluation has no use for it.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import pathlib
import sys
import time

import psycopg
import requests

ROOT = pathlib.Path(__file__).resolve().parents[2]
API = "https://api.inaturalist.org/v1/observations"
USER_AGENT = "conservation-tw-evalset/1.0 (classifier evaluation, testing only; github.com/28NS30/conservation)"

PLACE_TAIWAN = 7887
TERM_ALIVE_OR_DEAD = 17
VALUE_DEAD = 19
VERTEBRATA = 355675
MALACOSTRACA = 47187
CREATED_AFTER = "2024-06-01"
LICENCES = ("cc0", "cc-by", "cc-by-nc")

# Native animal -> the invasive species it is taken for. Chosen from the
# research run's own false positives (docs/ai-rollout.md) and the pairs TaiRON
# and the agriculture ministry warn the public about. Several natives here are
# protected: 八哥 and 金龜 class II, 黑頭白䴉 class II. A look-alike called
# invasive is a record a person might act on, and for these it is a protected
# animal's location published at the wrong blur.
LOOKALIKES: dict[str, list[str]] = {
    "Polypedates braueri": ["Polypedates megacephalus"],
    "Eutropis longicaudata": ["Eutropis multifasciata"],
    "Plestiodon elegans": ["Eutropis multifasciata"],
    "Mauremys sinensis": ["Trachemys scripta"],
    "Mauremys reevesii": ["Trachemys scripta"],
    "Acridotheres cristatellus": ["Acridotheres javanicus", "Acridotheres tristis"],
    "Fejervarya limnocharis": ["Fejervarya cancrivora"],
    "Rattus losea": ["Rattus exulans"],
    "Rattus tanezumi": ["Rattus exulans"],
    "Bandicota indica": ["Rattus exulans"],
    "Lycodon ruhstrati": ["Lycodon capucinus"],
    "Boiga kraepelini": ["Boiga irregularis"],
    "Diploderma swinhonis": ["Anolis sagrei", "Physignathus cocincinus", "Iguana iguana"],
    "Hemidactylus bowringii": ["Hemidactylus frenatus", "Hemidactylus brookii"],
    "Microhyla fissipes": ["Kaloula pulchra"],
    "Duttaphrynus melanostictus": ["Rhinella marina"],
    "Cipangopaludina chinensis": ["Pomacea canaliculata"],
    "Threskiornis melanocephalus": ["Threskiornis aethiopicus"],
    "Egretta garzetta": ["Threskiornis aethiopicus"],
}

# iNaturalist name -> the name our TaiCOL copy uses for the same species.
INAT_TO_TAICOL = {
    "Lissachatina fulica": "Achatina fulica",
    "Sylvirana guentheri": "Hylarana guentheri",
}

_last_request = 0.0


def polite_get(session: requests.Session, url: str, **kw) -> requests.Response:
    """GET, no sooner than one second after the previous request of any kind.

    A dropped connection is retried twice, backing off 5 then 20 seconds: the
    first build of the look-alike set died on one "Remote end closed
    connection" forty minutes in.
    """
    global _last_request
    for attempt, backoff in enumerate((5, 20, None)):
        wait = 1.0 - (time.monotonic() - _last_request)
        if wait > 0:
            time.sleep(wait)
        try:
            return session.get(url, timeout=60, **kw)
        except requests.ConnectionError:
            if backoff is None:
                raise
            time.sleep(backoff)
        finally:
            _last_request = time.monotonic()
    raise AssertionError("unreachable")


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


def load_species() -> dict[str, dict]:
    """Accepted Taiwan animal species by lower-cased binomial.

    Read-only. Only species rows: a photograph is scored at species level, so
    that is the truth each item is judged against.
    """
    with psycopg.connect(database_url()) as conn, conn.cursor() as cur:
        cur.execute(
            """
            select lower(scientific_name), taicol_id, scientific_name, common_name_zh,
                   class, is_invasive
              from taxa
             where taxon_status = 'accepted' and rank = 'Species' and is_in_taiwan
               and kingdom = 'Animalia' and bioclip_prompt is not null
             order by taicol_id
            """
        )
        out: dict[str, dict] = {}
        for key, taicol, name, zh, cls, inv in cur.fetchall():
            # Two accepted species rows with one name exist (TaiCOL duplicates).
            # The first by TaiCOL id stands for both: evaluation compares
            # binomials, so which one is the label does not change a score.
            out.setdefault(key, {"taicolId": taicol, "scientificName": name,
                                 "commonNameZh": zh, "class": cls, "isInvasive": bool(inv)})
        return out


def binomial(name: str) -> str | None:
    parts = name.split()
    if len(parts) < 2:
        return None
    return " ".join(parts[:2])


def resolve(inat_name: str, species: dict[str, dict]) -> dict | None:
    b = binomial(inat_name)
    if b is None:
        return None
    b = INAT_TO_TAICOL.get(b, b)
    return species.get(b.lower())


def allowed_photo(obs: dict) -> dict | None:
    """The observation's first photograph under a licence we may use."""
    for photo in obs.get("photos") or []:
        if (photo.get("license_code") or "").lower() in LICENCES and photo.get("url"):
            return photo
    return None


def is_dead(obs: dict) -> bool:
    return any(
        a.get("controlled_attribute_id") == TERM_ALIVE_OR_DEAD
        and a.get("controlled_value_id") == VALUE_DEAD
        for a in obs.get("annotations") or []
    )


def item_for(obs: dict, photo: dict, truth: dict, **extra) -> dict:
    photo_id = int(photo["id"])
    user = obs.get("user") or {}
    return {
        "photoId": photo_id,
        "observationId": int(obs["id"]),
        "observationUrl": obs.get("uri") or f"https://www.inaturalist.org/observations/{obs['id']}",
        # "medium" is 500px on the long side: BioCLIP sees 224px, so anything
        # larger is bandwidth spent on someone else's server for nothing.
        "imageUrl": photo["url"].replace("/square.", "/medium."),
        "file": f"images/{photo_id}.jpg",
        "license": photo.get("license_code"),
        "attribution": photo.get("attribution"),
        "observer": user.get("login"),
        "inatTaxon": (obs.get("taxon") or {}).get("name"),
        "taicolId": truth["taicolId"],
        "scientificName": truth["scientificName"],
        "commonNameZh": truth["commonNameZh"],
        "class": truth["class"],
        "truthInvasive": truth["isInvasive"],
        "observedOn": obs.get("observed_on"),
        "createdAt": obs.get("created_at"),
        **extra,
    }


def base_params() -> dict:
    return {
        "place_id": PLACE_TAIWAN,
        "quality_grade": "research",
        "photos": "true",
        "captive": "false",
        "created_d1": CREATED_AFTER,
        "photo_license": ",".join(LICENCES),
        "order_by": "id",
        "order": "asc",
    }


def collect_dead(session, species, per_species: int) -> tuple[list[dict], dict]:
    params = base_params() | {
        "term_id": TERM_ALIVE_OR_DEAD,
        "term_value_id": VALUE_DEAD,
        "taxon_id": f"{VERTEBRATA},{MALACOSTRACA}",
        "per_page": 200,
    }
    items: list[dict] = []
    per: dict[str, int] = {}
    unmatched: dict[str, int] = {}
    seen = 0
    id_above = 0
    while True:
        r = polite_get(session, API, params=params | {"id_above": id_above})
        r.raise_for_status()
        results = r.json().get("results") or []
        if not results:
            break
        for obs in results:
            seen += 1
            id_above = max(id_above, int(obs["id"]))
            if not is_dead(obs):
                continue  # belt and braces: the filter is the API's
            name = (obs.get("taxon") or {}).get("name") or ""
            truth = resolve(name, species)
            if truth is None:
                unmatched[name] = unmatched.get(name, 0) + 1
                continue
            if per.get(truth["taicolId"], 0) >= per_species:
                continue
            photo = allowed_photo(obs)
            if photo is None:
                continue
            items.append(item_for(obs, photo, truth, set="dead"))
            per[truth["taicolId"]] = per.get(truth["taicolId"], 0) + 1
        print(f"  {seen} observations read, {len(items)} kept", flush=True)
    return items, {"observationsRead": seen, "unmatchedNames": unmatched}


def collect_lookalike(session, species, per_species: int) -> tuple[list[dict], dict]:
    wanted: dict[str, dict] = {}
    for native, invasives in LOOKALIKES.items():
        wanted.setdefault(native, {"role": "native-lookalike", "pairedWith": []})["pairedWith"] += invasives
        for inv in invasives:
            wanted.setdefault(inv, {"role": "invasive", "pairedWith": []})["pairedWith"].append(native)

    items: list[dict] = []
    missing: list[str] = []
    for name, meta in wanted.items():
        truth = resolve(name, species)
        if truth is None:
            missing.append(f"{name} (not an accepted Taiwan animal in this database)")
            continue
        inat_name = {v: k for k, v in INAT_TO_TAICOL.items()}.get(name, name)
        r = polite_get(session, API, params=base_params() | {"taxon_name": inat_name, "per_page": 60})
        r.raise_for_status()
        taken = 0
        for obs in r.json().get("results") or []:
            if taken >= per_species:
                break
            if is_dead(obs):
                continue  # the dead set covers those; this set is the live look-alike
            got = resolve((obs.get("taxon") or {}).get("name") or "", species)
            if got is None or got["taicolId"] != truth["taicolId"]:
                continue
            photo = allowed_photo(obs)
            if photo is None:
                continue
            items.append(item_for(obs, photo, truth, set="lookalike", role=meta["role"],
                                  pairedWith=sorted(set(meta["pairedWith"]))))
            taken += 1
        print(f"  {name}: {taken}", flush=True)
        if taken == 0:
            missing.append(f"{name} (no usable observation)")
    return items, {"missing": missing}


def download(session, items: list[dict], out_dir: pathlib.Path) -> list[dict]:
    (out_dir / "images").mkdir(parents=True, exist_ok=True)
    kept = []
    for n, item in enumerate(items, 1):
        dest = out_dir / item["file"]
        if not dest.exists():
            try:
                r = polite_get(session, item["imageUrl"])
                if r.status_code != 200 or not r.content:
                    print(f"  ! {item['imageUrl']}: HTTP {r.status_code}", flush=True)
                    continue
                dest.write_bytes(r.content)
            except requests.RequestException as e:
                print(f"  ! {item['imageUrl']}: {e}", flush=True)
                continue
        kept.append(item)
        if n % 50 == 0 or n == len(items):
            print(f"  images {n}/{len(items)}", flush=True)
    return kept


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("set", choices=["dead", "lookalike"])
    ap.add_argument("--per-species", type=int, default=10)
    ap.add_argument("--no-download", action="store_true", help="write the manifest only")
    args = ap.parse_args()

    out_dir = ROOT / "data" / f"evalset-{args.set}"
    out_dir.mkdir(parents=True, exist_ok=True)
    species = load_species()
    session = requests.Session()
    session.headers["User-Agent"] = USER_AGENT

    print(f"Building the {args.set} set (at most {args.per_species} per species)…", flush=True)
    if args.set == "dead":
        items, notes = collect_dead(session, species, args.per_species)
    else:
        items, notes = collect_lookalike(session, species, args.per_species)

    if not args.no_download:
        items = download(session, items, out_dir)

    (out_dir / "manifest.jsonl").write_text("".join(json.dumps(i, ensure_ascii=False) + "\n" for i in items))
    summary = {
        "set": args.set,
        "builtAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "source": "iNaturalist API v1 (api.inaturalist.org/v1/observations)",
        "use": "classifier evaluation only; never training, never published",
        "query": base_params() | ({"term_id": TERM_ALIVE_OR_DEAD, "term_value_id": VALUE_DEAD,
                                    "taxon_id": f"{VERTEBRATA},{MALACOSTRACA}"} if args.set == "dead" else {}),
        "perSpecies": args.per_species,
        "items": len(items),
        "species": len({i["taicolId"] for i in items}),
        **notes,
    }
    (out_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
    print(f"\n  wrote {out_dir}/manifest.jsonl: {len(items)} photographs of {summary['species']} species", flush=True)


if __name__ == "__main__":
    sys.exit(main())
