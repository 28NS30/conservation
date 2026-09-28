"""What the classifier endpoint answers, and the arithmetic behind the answer.

There are two response contracts, served side by side so the website can move
from one to the other without a moment where neither works:

  contract 1  (a request with no "contract", or "contract": 1)
      The original. The request names a category, the model scores the photo
      against that category's label list (labelsets.py), bands the answer and
      returns its top 5 as `taxa.id` values from the v1 embeddings. Every
      deployed website before ML_CONTRACT=2 speaks this, so it must keep
      working until that website is gone.

  contract 2  ("contract": 2)
      The model returns EVIDENCE and the website DECIDES. The photo is scored
      against every accepted Taiwan taxon at once, the probability of each
      subspecies, variety and form is added into its species, and the top 50
      species come back as {taicol_id, score}. No category, no mask, no band:
      which species a page may be named as, how sure the model must be, and
      whether an invasive answer is only ever a suggestion are all rules the
      website applies to live `taxa` rows (apps/web/lib/report/classifyPolicy.ts).

Why the second exists at all (the measurements are in docs/ai-rollout.md):

  * The v1 label list holds deleted names and subspecies beside their species,
    and a softmax splits a photo's probability between rows that are the same
    animal. 紅冠水雞 Gallinula chloropus had about 0.99 of the mass across its
    rows, and its best single row scored 0.52 — below the band that names a
    species. Adding a species' rows together is what this module does.

  * The invasive page's list held ONLY invasive species, so every photo was
    forced onto one: 100 of 276 native animals on the live set, and 110 of 173
    on the native look-alike set, came back as an invasive species in the high
    band. Scoring against everything and letting the website ask "is the top
    answer itself invasive?" takes the look-alikes to 5 of 173, and it needs
    the whole set here, not a mask.

  * Keys. v1 rows are keyed by `taxa.id`, a bigserial a fresh import renumbers.
    v2 rows are keyed by TaiCOL's own id, which survives one.

Numpy only, deliberately: this is the part that decides what the website is
told, so it is the part the tests exercise, and CI has no torch.
"""

from __future__ import annotations

import json
import pathlib
from dataclasses import dataclass

import numpy as np

CONTRACT_LEGACY = 1
CONTRACT_EVIDENCE = 2

# How many species the evidence contract returns. Enough that each rule set
# the website applies still has a top 5 after it drops what that page may not
# be named as (plants, fish on a roadkill report). Measured 2026-09-28: the
# fifth answer a rule set could give sat at most 32nd on the live set and 49th
# on the dead-animal set, where 86 of 1,144 photos had fewer than five in the
# fifty and so show fewer suggestions. Raising it costs only bytes; the
# response is a few kilobytes.
TOP_N = 50


class ContractError(ValueError):
    """A request asked for a contract this service does not speak."""


class EmbeddingsMissing(RuntimeError):
    """An embedding set a request needs is not where the service reads it.

    Raised per request rather than at start-up, so a container whose volume
    holds only one version still answers the contract that version serves.
    That is the rollout: the v2 files are uploaded before any website asks for
    them, and the v1 files stay until no website does (docs/ai-rollout.md).
    """


def requested_contract(payload: dict) -> int:
    """Which contract a request asked for.

    Absent means the legacy contract, because that is what every website
    deployed before this change sends. Anything other than 1 or 2 is refused
    rather than quietly answered in the legacy shape: a website that asked for
    a contract it did not get would read the wrong fields and see no answer.
    """
    raw = payload.get("contract")
    if raw is None:
        return CONTRACT_LEGACY
    # bool is an int in Python; `"contract": true` is not a version number.
    if isinstance(raw, bool) or raw not in (CONTRACT_LEGACY, CONTRACT_EVIDENCE):
        raise ContractError(f"unsupported contract {raw!r}; this service speaks 1 and 2")
    return int(raw)


def softmax(logits: np.ndarray) -> np.ndarray:
    """Numerically stable softmax over the WHOLE vector.

    Over the whole vector is the point. A softmax over a subset has no
    "none of these", so a photo of something outside the subset is still
    forced to sum to 1 inside it — which is how a native tree frog came back
    as the invasive one at 0.98.
    """
    z = logits.astype(np.float64) - float(np.max(logits))
    p = np.exp(z)
    return p / p.sum()


@dataclass(frozen=True)
class SpeciesIndex:
    """Which species each embedding row belongs to.

    `row_taicol[i]`   the TaiCOL id of row i (a species, or a subspecies,
                      variety or form kept as an extra embedding of its species)
    `species[k]`      the TaiCOL id of species k, the only ids ever returned
    `row_species[i]`  k such that row i's probability is added into species k
    """

    row_taicol: np.ndarray
    species: np.ndarray
    row_species: np.ndarray

    @classmethod
    def from_keys(cls, taicol_ids: list[str], species_taicol_ids: list[str]) -> "SpeciesIndex":
        if len(taicol_ids) != len(species_taicol_ids):
            raise ValueError(
                f"{len(taicol_ids)} row ids but {len(species_taicol_ids)} species ids: the keys file is corrupt"
            )
        if len(set(taicol_ids)) != len(taicol_ids):
            raise ValueError("a TaiCOL id appears on more than one embedding row")
        species, row_species = np.unique(np.asarray(species_taicol_ids), return_inverse=True)
        # Every species key must also be a row of its own. A key with no row
        # would be a species the model can only ever reach through a
        # subspecies, which build_embeddings.py never writes; if it appears,
        # the file was not written by it.
        missing = set(species.tolist()) - set(taicol_ids)
        if missing:
            raise ValueError(f"{len(missing)} species keys have no embedding row of their own, e.g. {sorted(missing)[:3]}")
        return cls(
            row_taicol=np.asarray(taicol_ids),
            species=species,
            row_species=row_species.astype(np.int64),
        )

    @property
    def n_rows(self) -> int:
        return int(self.row_taicol.shape[0])

    @property
    def n_species(self) -> int:
        return int(self.species.shape[0])


def load_keys(path: pathlib.Path) -> SpeciesIndex:
    """Read the keys file build_embeddings.py writes beside the v2 matrix."""
    meta = json.loads(path.read_text())
    return SpeciesIndex.from_keys(meta["taicol_ids"], meta["species_taicol_ids"])


def collapse_to_species(probs: np.ndarray, index: SpeciesIndex) -> np.ndarray:
    """Add each row's probability into its species.

    A photograph cannot tell 環頸雉's endemic subspecies from the introduced
    ones, and the model is not asked to: a species' score is the sum over the
    species row and every infraspecific row under it. The result still sums to
    1 over all species, because every row belongs to exactly one.
    """
    if probs.shape[0] != index.n_rows:
        raise ValueError(f"{probs.shape[0]} scores for {index.n_rows} embedding rows")
    return np.bincount(index.row_species, weights=probs, minlength=index.n_species)


def top_species(species_probs: np.ndarray, index: SpeciesIndex, n: int = TOP_N) -> list[dict]:
    """The n most probable species, most probable first.

    Ties are broken by TaiCOL id so the same photo always gets the same answer
    in the same order; argsort alone is not stable across numpy builds.
    """
    n = min(n, index.n_species)
    if n <= 0:
        return []
    # argpartition then an exact sort of the survivors: 50 out of ~65k.
    part = np.argpartition(-species_probs, n - 1)[:n]
    order = sorted(part.tolist(), key=lambda k: (-float(species_probs[k]), str(index.species[k])))
    return [{"taicol_id": str(index.species[k]), "score": float(species_probs[k])} for k in order]


def evidence(logits: np.ndarray, index: SpeciesIndex, n: int = TOP_N) -> list[dict]:
    """Logits over every embedding row -> the contract-2 candidate list."""
    return top_species(collapse_to_species(softmax(logits), index), index, n)
