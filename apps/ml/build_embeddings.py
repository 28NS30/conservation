"""Precompute BioCLIP text embeddings for every accepted Taiwan taxon (v2).

    ML_DEVICE=mps python apps/ml/build_embeddings.py

Encoding ~69k taxon prompts takes minutes; doing it per request would be absurd.
This runs once, producing a matrix that inference reduces to a single matmul.

Outputs, versioned so a rebuild cannot corrupt in-flight requests, and never
overwriting another version's files:

    data/embeddings/taxa_embeddings_v2.npy   float16, L2-normalised, (N, dim)
    data/embeddings/taxa_keys_v2.json        per row: its TaiCOL id and the
                                             species TaiCOL id it adds into

WHAT CHANGED FROM v1, AND WHY. v1 embedded every prompted Taiwan row: 70,805 of
them, of which 1,754 were names TaiCOL has deleted and 693 groups were the same
prompt twice (青蛇 Cyclophiops major, accepted and deleted, is one). The
classifier's softmax split a photo between rows that are the same animal, so a
correct answer often scored about 0.5 and never reached the band that names a
species; measured on the live evaluation set, 42 of 119 "wrong" top-1 answers
were the right species under another row. So v2:

  * takes ACCEPTED rows only. A deleted name is not an answer anyone should be
    given, and the website refuses it as a report's species anyway;
  * keys every row by TaiCOL id, not `taxa.id`. `taxa.id` is a bigserial that a
    fresh import renumbers, and a v1 matrix built against one database and
    served against another names the wrong species with no error anywhere
    (scripts/preflight.ts checks the alignment, now for every row);
  * keeps each subspecies, variety and form as an extra row of its species.
    The model is asked "which species", because a photograph cannot tell
    環頸雉's protected endemic subspecies from the introduced ones; the
    subspecies' prompt is still worth scoring, since it describes the same
    animal, and its probability is added into the species (contract.py);
  * drops a prompt identical to one already kept. Two rows with one prompt
    have one embedding, and scoring it twice only splits the mass again.

It does NOT write to the database. v1 wrote `taxa.embedding_row`, a row index
into its own matrix, which nothing reads; a v2 row index would be meaningless
there, and this script has no business changing a shared table to build a file.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import pathlib
import sys
import time

import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from contract import SpeciesIndex  # noqa: E402

# torch (through bioclip) and psycopg are imported inside main(), so the row
# rules below can be tested on a machine with neither (test_contract.py, CI).

OUT_DIR = pathlib.Path(
    os.environ.get("EMBED_OUT_DIR")
    or pathlib.Path(__file__).resolve().parents[2] / "data" / "embeddings"
)

# Every accepted, prompted Taiwan row, and the accepted species each one adds
# into. Infraspecific rows climb `parent_taicol_id` to the nearest Species row;
# 44 TaiCOL rows sit under another infraspecific row rather than directly under
# a species (the same climb as taxon_precision() in migration 0014), and the
# depth limit only guards against a cycle in the source data.
ROWS_SQL = """
with recursive cand as (
  select taicol_id, parent_taicol_id, rank, bioclip_prompt
    from taxa
   where bioclip_prompt is not null
     and is_in_taiwan
     and taxon_status = 'accepted'
),
up as (
  select c.taicol_id as start, c.parent_taicol_id as cur, 0 as depth
    from cand c
   where c.rank is distinct from 'Species'
  union all
  select up.start, p.parent_taicol_id, up.depth + 1
    from up
    join taxa p on p.taicol_id = up.cur
   where p.rank is distinct from 'Species'
     and up.depth < 6
)
select c.taicol_id,
       c.rank,
       c.bioclip_prompt,
       case when c.rank = 'Species' then c.taicol_id
            else (select s.taicol_id
                    from up
                    join cand s on s.taicol_id = up.cur
                   where up.start = c.taicol_id
                     and s.rank = 'Species'
                   limit 1)
       end as species_taicol_id
  from cand c
 order by c.taicol_id
"""


def database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if url:
        return url
    env = pathlib.Path(__file__).resolve().parents[2] / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("DATABASE_URL="):
                return line.split("=", 1)[1].strip()
    raise SystemExit("DATABASE_URL is not set")


def select_rows(rows: list[tuple[str, str | None, str, str | None]]):
    """Decide which rows get an embedding, and what each adds into.

    `rows` is (taicol_id, rank, prompt, species_taicol_id or None), sorted by
    TaiCOL id. Pure, so the rules are testable without a database or a model.

    Returns (kept, dropped, orphans):
      kept     [(taicol_id, prompt, species_taicol_id)]
      dropped  [{"taicol_id", "kept_as"}]  identical prompt already embedded
      orphans  [taicol_id]  infraspecific rows with no accepted Taiwan species
               above them, kept as their own key so their probability is not
               silently lost (none in the copy this was written against)
    """
    by_prompt: dict[str, list[tuple[str, str | None, str]]] = {}
    orphans: list[str] = []
    for taicol_id, rank, prompt, species in rows:
        if species is None:
            orphans.append(taicol_id)
            species = taicol_id
        by_prompt.setdefault(prompt, []).append((taicol_id, rank, species))

    kept: list[tuple[str, str, str]] = []
    dropped: list[dict] = []
    for prompt, group in by_prompt.items():
        # Prefer a species row (it is the answer the website is given), then the
        # lowest TaiCOL id, so a rebuild keeps the same row every time.
        group.sort(key=lambda r: (r[1] != "Species", r[0]))
        keep = group[0]
        kept.append((keep[0], prompt, keep[2]))
        for other in group[1:]:
            dropped.append({"taicol_id": other[0], "kept_as": keep[0]})

    kept.sort(key=lambda r: r[0])
    # A species key that lost its own row to a duplicate prompt would be
    # unreachable except through its subspecies. Re-point those rows at the
    # row that was kept for the species' prompt.
    kept_ids = {k[0] for k in kept}
    redirect = {d["taicol_id"]: d["kept_as"] for d in dropped}
    kept = [
        (t, p, s if s in kept_ids else redirect.get(s, t))
        for t, p, s in kept
    ]
    return kept, dropped, orphans


def main() -> None:
    import psycopg

    from bioclip import EMBED_VERSION, MODEL_HUB, encode_texts

    limit = int(os.environ.get("EMBED_LIMIT", "0"))  # 0 = all; small values for smoke tests

    with psycopg.connect(database_url()) as conn, conn.cursor() as cur:
        cur.execute(ROWS_SQL)
        rows = cur.fetchall()

    if not rows:
        raise SystemExit("No accepted taxa with bioclip_prompt — run import:taicol first.")

    kept, dropped, orphans = select_rows(rows)
    if limit:
        # A smoke-test build keeps whole species, so the keys file still validates.
        species = sorted({s for _, _, s in kept})[:limit]
        keep_species = set(species)
        kept = [k for k in kept if k[2] in keep_species]

    taicol_ids = [k[0] for k in kept]
    species_ids = [k[2] for k in kept]
    index = SpeciesIndex.from_keys(taicol_ids, species_ids)  # validates before a long encode
    prompts = [k[1] for k in kept]

    print(
        f"{len(rows):,} accepted prompted Taiwan rows -> {len(kept):,} embeddings "
        f"for {index.n_species:,} species "
        f"({len(dropped):,} identical prompts dropped, {len(orphans):,} orphans)",
        flush=True,
    )

    def report(done: int, total: int, elapsed: float) -> None:
        rate = done / elapsed if elapsed else 0
        eta = (total - done) / rate if rate else 0
        print(
            f"  {done:,}/{total:,} ({done/total:.0%})  {rate:.0f}/s  eta {eta/60:.1f}m",
            flush=True,
        )

    t0 = time.time()
    emb = encode_texts(prompts, on_progress=report)
    print(f"  done in {time.time() - t0:.1f}s -> {emb.shape}", flush=True)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    emb_path = OUT_DIR / f"taxa_embeddings_{EMBED_VERSION}.npy"
    keys_path = OUT_DIR / f"taxa_keys_{EMBED_VERSION}.json"
    # Write to temporary names and rename, so a crash mid-write cannot leave a
    # matrix and a keys file that disagree about how many rows there are.
    tmp_emb = emb_path.with_suffix(".npy.tmp")
    tmp_keys = keys_path.with_suffix(".json.tmp")
    with open(tmp_emb, "wb") as fh:
        np.save(fh, emb.astype(np.float16))
    tmp_keys.write_text(json.dumps({
        "version": EMBED_VERSION,
        "model": MODEL_HUB,
        "built_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "count": len(kept),
        "species_count": index.n_species,
        "taicol_ids": taicol_ids,
        "species_taicol_ids": species_ids,
        "identical_prompts_dropped": dropped,
        "orphans": orphans,
    }))
    tmp_emb.replace(emb_path)
    tmp_keys.replace(keys_path)

    size_mb = emb_path.stat().st_size / 1e6
    print(
        f"\n  wrote {OUT_DIR}\n"
        f"  rows        {len(kept):,}\n"
        f"  species     {index.n_species:,}\n"
        f"  dim         {emb.shape[1]}\n"
        f"  matrix      {size_mb:.0f} MB (float16)"
    )


if __name__ == "__main__":
    main()
