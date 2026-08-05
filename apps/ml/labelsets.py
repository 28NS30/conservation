"""Category -> candidate label set.

Narrowing the candidate set is the single largest accuracy win available, and it
costs nothing but a boolean mask over the precomputed embedding matrix.

An `invasive` report is scored against the ~274 taxa TaiCOL marks as invasive
rather than all 66k Taiwan species — a 240x reduction in the decision space for
exactly the reports where a confident answer matters most (green iguana, apple
snail, fire ant, brown anole, mile-a-minute weed).
"""

from __future__ import annotations

import json
import pathlib

import numpy as np

# Categories whose photos are worth classifying at all. Mirrors CATEGORIES in
# packages/shared/src/index.ts.
CLASSIFIABLE = {"roadkill", "invasive", "injured", "sighting"}


class LabelSets:
    def __init__(self, meta_path: pathlib.Path, n: int):
        meta = json.loads(meta_path.read_text())
        self.n = n
        self._invasive = self._mask(meta.get("invasive", []))
        self._marine = self._mask(meta.get("marine", []))
        self._terrestrial = self._mask(meta.get("terrestrial", []))

    def _mask(self, indices: list[int]) -> np.ndarray:
        m = np.zeros(self.n, dtype=bool)
        if indices:
            m[np.asarray(indices, dtype=np.int64)] = True
        return m

    def for_category(self, category: str) -> np.ndarray | None:
        """Boolean mask over embedding rows, or None meaning 'all Taiwan taxa'."""
        if category == "invasive":
            # Only fall back to everything if the checklist has no invasives loaded.
            return self._invasive if self._invasive.any() else None

        if category == "roadkill":
            # Roadkill is by definition terrestrial. Excluding marine-only taxa
            # removes ~20k fish that a road casualty can never be. Taxa with no
            # habitat flags are kept — absent data must not silently drop a species.
            keep = ~(self._marine & ~self._terrestrial)
            return keep if keep.any() else None

        return None
