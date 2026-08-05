"""Precompute BioCLIP text embeddings for every Taiwan taxon.

    python apps/ml/build_embeddings.py

Encoding ~66k taxon prompts takes minutes; doing it per request would be absurd.
This runs once, producing a matrix that inference reduces to a single matmul.

Outputs, versioned so a rebuild cannot corrupt in-flight requests:
    data/embeddings/taxa_embeddings_v1.npy   float16, L2-normalised, (N, dim)
    data/embeddings/taxa_ids_v1.npy          int64 taxa.id, parallel to rows
    data/embeddings/taxa_meta_v1.json        flags used to build category masks

It also writes `taxa.embedding_row` back to the database so a taxon id can be
mapped to its row without loading the ids file.
"""

from __future__ import annotations

import json
import os
import pathlib
import sys
import time

import numpy as np
import psycopg

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from bioclip import encode_texts, EMBED_VERSION  # noqa: E402

OUT_DIR = pathlib.Path(__file__).resolve().parents[2] / "data" / "embeddings"


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


def main() -> None:
    limit = int(os.environ.get("EMBED_LIMIT", "0"))  # 0 = all; small values for smoke tests

    with psycopg.connect(database_url()) as conn, conn.cursor() as cur:
        cur.execute(
            f"""
            select id, bioclip_prompt, coalesce(is_invasive,false), protected_status is not null,
                   coalesce(is_terrestrial,false), coalesce(is_marine,false)
              from taxa
             where bioclip_prompt is not null and is_in_taiwan
             order by id
             {"limit %s" % limit if limit else ""}
            """
        )
        rows = cur.fetchall()

    if not rows:
        raise SystemExit("No taxa with bioclip_prompt — run import:taicol first.")

    ids = np.array([r[0] for r in rows], dtype=np.int64)
    prompts = [r[1] for r in rows]
    meta = {
        "version": EMBED_VERSION,
        "count": len(rows),
        "invasive": [i for i, r in enumerate(rows) if r[2]],
        "protected": [i for i, r in enumerate(rows) if r[3]],
        "terrestrial": [i for i, r in enumerate(rows) if r[4]],
        "marine": [i for i, r in enumerate(rows) if r[5]],
    }

    print(f"Encoding {len(prompts):,} taxon prompts…", flush=True)

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
    np.save(OUT_DIR / f"taxa_embeddings_{EMBED_VERSION}.npy", emb.astype(np.float16))
    np.save(OUT_DIR / f"taxa_ids_{EMBED_VERSION}.npy", ids)
    (OUT_DIR / f"taxa_meta_{EMBED_VERSION}.json").write_text(json.dumps(meta))

    # Map taxon -> row, so the app can resolve without loading the ids file.
    with psycopg.connect(database_url()) as conn, conn.cursor() as cur:
        cur.execute("update taxa set embedding_row = null where embedding_row is not null")
        cur.executemany(
            "update taxa set embedding_row = %s where id = %s",
            [(int(i), int(t)) for i, t in enumerate(ids)],
        )
        conn.commit()

    size_mb = (OUT_DIR / f"taxa_embeddings_{EMBED_VERSION}.npy").stat().st_size / 1e6
    print(
        f"\n  wrote {OUT_DIR}\n"
        f"  taxa        {len(ids):,}\n"
        f"  dim         {emb.shape[1]}\n"
        f"  matrix      {size_mb:.0f} MB (float16)\n"
        f"  invasive    {len(meta['invasive']):,}\n"
        f"  protected   {len(meta['protected']):,}"
    )


if __name__ == "__main__":
    main()
