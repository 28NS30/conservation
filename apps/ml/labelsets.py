"""Category -> candidate label set. THE LEGACY CONTRACT ONLY.

Under the evidence contract ("contract": 2, contract.py) nothing here runs: the
model scores every accepted Taiwan taxon and the website applies each report
type's rules to live `taxa` rows (apps/web/lib/report/classifyPolicy.ts). This
file stays, unchanged, for every website that still sends a category, until
none does (docs/ai-rollout.md).

Narrowing the candidate set is the single largest accuracy win available, and it
costs nothing but a boolean mask over the precomputed embedding matrix.

An `invasive` report is scored against the ~274 taxa TaiCOL marks as invasive
rather than all 66k Taiwan species — a 240x reduction in the decision space for
exactly the reports where a confident answer matters most (green iguana, apple
snail, fire ant, brown anole, mile-a-minute weed).

That reduction is also why an invasive answer is never taken as an
identification. A closed list has no "none of these": 100 of 276 native
animals in the evaluation set came back as an invasive species in the high
band. The website stores the answer as a suggestion only
(apps/web/lib/report/classifyPolicy.ts); nothing here changes that.
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
        self._protected = self._mask(meta.get("protected", []))

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
            #
            # Protected taxa are kept whatever their habitat. A category whose
            # answer can become the record's species (AUTO_ASSIGN_CATEGORIES in
            # apps/web/lib/report/classifyPolicy.ts) must be scored against a
            # list that still holds every protected animal: a softmax over a
            # list without the right answer puts its weight on the nearest
            # wrong one, and the record is published under that one's blur. The
            # habitat mask alone dropped all 37 marine mammals (36 protected)
            # and all 5 sea turtles, and a sea turtle does cross a coastal road.
            #
            # `injured` is deliberately NOT narrowed here and falls through to
            # the whole checklist. It is filed from the same "roadkill or
            # injured" choice, but a stranded dolphin or turtle is exactly what
            # an injured-wildlife report is for.
            keep = ~(self._marine & ~self._terrestrial) | self._protected
            return keep if keep.any() else None

        return None
