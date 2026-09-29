"""What the classifier tells the website, tested without a model.

    python -m unittest discover -s apps/ml -p "test_*.py"

numpy only: CI has no torch, no GPU and no Modal account, and none of what is
tested here needs them. Each test is written against a defect that would reach
the website unannounced — a mask before the softmax, a subspecies scored apart
from its species, a request that says nothing answered in the new shape — and
fails if that defect is put back.
"""

from __future__ import annotations

import pathlib
import sys
import unittest

import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).parent))

import contract  # noqa: E402
from build_embeddings import select_rows  # noqa: E402
from contract import (  # noqa: E402
    CONTRACT_EVIDENCE,
    CONTRACT_LEGACY,
    TOP_N,
    ContractError,
    EmbeddingsMissing,
    SpeciesIndex,
    collapse_to_species,
    evidence,
    requested_contract,
    softmax,
    top_species,
)
from endpoint import Request, handle, parse  # noqa: E402


def index(rows: list[tuple[str, str]]) -> SpeciesIndex:
    return SpeciesIndex.from_keys([r[0] for r in rows], [r[1] for r in rows])


class Contracts(unittest.TestCase):
    def test_a_request_that_says_nothing_gets_the_legacy_contract(self):
        # Every website deployed before ML_CONTRACT=2 sends no "contract". If
        # absence meant the new one, the rollout's first step (deploying the
        # model service) would break the live site before the website changed.
        self.assertEqual(requested_contract({}), CONTRACT_LEGACY)
        self.assertEqual(requested_contract({"contract": None}), CONTRACT_LEGACY)
        self.assertEqual(requested_contract({"contract": 1}), CONTRACT_LEGACY)

    def test_contract_2_is_asked_for_by_number(self):
        self.assertEqual(requested_contract({"contract": 2}), CONTRACT_EVIDENCE)

    def test_anything_else_is_refused_rather_than_answered_in_the_old_shape(self):
        for bad in (3, 0, "2", True, 2.5, [2]):
            with self.assertRaises(ContractError, msg=repr(bad)):
                requested_contract({"contract": bad})


class Collapse(unittest.TestCase):
    def test_a_subspecies_adds_into_its_species(self):
        # 紅冠水雞 had about 0.99 of the mass spread over its rows and 0.52 on
        # the best one, so it never reached the band that names a species.
        idx = index([("tS", "tS"), ("tSssp", "tS"), ("tOther", "tOther")])
        probs = np.array([0.40, 0.35, 0.25])
        species = collapse_to_species(probs, idx)
        by_key = dict(zip(idx.species.tolist(), species.tolist()))
        self.assertAlmostEqual(by_key["tS"], 0.75)
        self.assertAlmostEqual(by_key["tOther"], 0.25)
        self.assertAlmostEqual(float(species.sum()), 1.0)

    def test_collapse_can_change_which_species_is_top(self):
        idx = index([("tS", "tS"), ("tSssp", "tS"), ("tOther", "tOther")])
        top = top_species(collapse_to_species(np.array([0.3, 0.3, 0.4]), idx), idx)
        self.assertEqual(top[0]["taicol_id"], "tS")
        self.assertAlmostEqual(top[0]["score"], 0.6)

    def test_only_species_keys_are_ever_returned(self):
        idx = index([("tS", "tS"), ("tSssp", "tS"), ("tOther", "tOther")])
        out = evidence(np.array([5.0, 9.0, 1.0]), idx)
        self.assertEqual({c["taicol_id"] for c in out}, {"tS", "tOther"})

    def test_a_keys_file_that_does_not_describe_the_matrix_is_refused(self):
        with self.assertRaises(ValueError):
            SpeciesIndex.from_keys(["a", "b"], ["a"])  # lengths differ
        with self.assertRaises(ValueError):
            SpeciesIndex.from_keys(["a", "a"], ["a", "a"])  # a row twice
        with self.assertRaises(ValueError):
            # A species only reachable through its subspecies.
            SpeciesIndex.from_keys(["ssp"], ["species"])


class WholeSetSoftmax(unittest.TestCase):
    def test_scores_are_shares_of_the_whole_candidate_set(self):
        # The invasive page's failure, in miniature: scored against a subset,
        # a photo that belongs outside it is still forced to sum to 1 inside
        # it. Here the native frog holds most of the mass; the invasive one's
        # score must stay its share of EVERYTHING, not of whatever subset a
        # page might care about.
        idx = index([("native", "native"), ("invasive", "invasive"), ("plant", "plant")])
        logits = np.array([8.0, 6.0, 1.0])
        out = {c["taicol_id"]: c["score"] for c in evidence(logits, idx)}
        expected = softmax(logits)
        self.assertAlmostEqual(out["invasive"], float(expected[1]))
        self.assertLess(out["invasive"], 0.2)
        masked = softmax(logits[[1]])[0]  # what a mask before the softmax gives
        self.assertNotAlmostEqual(out["invasive"], float(masked))

    def test_softmax_is_stable_for_large_logits(self):
        p = softmax(np.array([1000.0, 999.0, -1000.0]))
        self.assertTrue(np.all(np.isfinite(p)))
        self.assertAlmostEqual(float(p.sum()), 1.0)


class TopN(unittest.TestCase):
    def test_top_50_most_probable_first(self):
        n = 120
        rng = np.random.default_rng(7)
        idx = index([(f"t{i:04d}", f"t{i:04d}") for i in range(n)])
        out = evidence(rng.normal(size=n) * 3, idx)
        self.assertEqual(len(out), TOP_N)
        self.assertEqual(TOP_N, 50)
        scores = [c["score"] for c in out]
        self.assertEqual(scores, sorted(scores, reverse=True))

    def test_the_fifty_are_the_largest(self):
        n = 200
        idx = index([(f"t{i:04d}", f"t{i:04d}") for i in range(n)])
        logits = np.linspace(-5, 5, n)
        out = evidence(logits, idx)
        self.assertEqual([c["taicol_id"] for c in out], [f"t{i:04d}" for i in range(n - 1, n - 51, -1)])

    def test_ties_are_ordered_the_same_way_every_time(self):
        idx = index([("tb", "tb"), ("ta", "ta"), ("tc", "tc")])
        out = evidence(np.zeros(3), idx)
        self.assertEqual([c["taicol_id"] for c in out], ["ta", "tb", "tc"])

    def test_fewer_species_than_fifty_returns_them_all(self):
        idx = index([("a", "a"), ("b", "b")])
        self.assertEqual(len(evidence(np.array([1.0, 2.0]), idx)), 2)

    def test_scores_are_plain_floats_and_ids_plain_strings(self):
        # numpy scalars do not survive json.dumps in FastAPI's encoder path.
        idx = index([("a", "a"), ("b", "b")])
        for c in evidence(np.array([1.0, 2.0]), idx):
            self.assertIs(type(c["score"]), float)
            self.assertIs(type(c["taicol_id"]), str)


class BuildRows(unittest.TestCase):
    def test_identical_prompts_are_embedded_once(self):
        kept, dropped, orphans = select_rows([
            ("t1", "Species", "a photo of X y.", "t1"),
            ("t2", "Species", "a photo of X y.", "t2"),  # a TaiCOL duplicate
            ("t3", "Subspecies", "a photo of X y z.", "t1"),
        ])
        self.assertEqual([k[0] for k in kept], ["t1", "t3"])
        self.assertEqual(dropped, [{"taicol_id": "t2", "kept_as": "t1"}])
        self.assertEqual(orphans, [])

    def test_the_species_row_wins_a_tie_with_its_subspecies(self):
        kept, dropped, _ = select_rows([
            ("t0", "Subspecies", "a photo of X y.", "t9"),
            ("t9", "Species", "a photo of X y.", "t9"),
        ])
        self.assertEqual([k[0] for k in kept], ["t9"])
        self.assertEqual(dropped, [{"taicol_id": "t0", "kept_as": "t9"}])

    def test_rows_of_a_dropped_species_move_to_the_row_kept_for_it(self):
        kept, _, _ = select_rows([
            ("t1", "Species", "a photo of X y.", "t1"),
            ("t2", "Species", "a photo of X y.", "t2"),
            ("t5", "Subspecies", "a photo of X y w.", "t2"),
        ])
        self.assertEqual(dict((k[0], k[2]) for k in kept), {"t1": "t1", "t5": "t1"})
        index([(k[0], k[2]) for k in kept])  # and the result is a valid keys file

    def test_a_subspecies_with_no_species_above_it_is_kept_as_its_own(self):
        kept, _, orphans = select_rows([("t7", "Subspecies", "a photo of X y z.", None)])
        self.assertEqual(kept, [("t7", "a photo of X y z.", "t7")])
        self.assertEqual(orphans, ["t7"])


class FakeResult:
    def __init__(self, body):
        self.body = body

    def to_dict(self):
        return self.body


class FakeClassifier:
    def __init__(self, missing_v2=False):
        self.calls = []
        self.missing_v2 = missing_v2

    def classify(self, blob, category):
        self.calls.append(("classify", category))
        return FakeResult({"predictions": [{"taxon_id": 1, "score": 0.9, "rank": 1}],
                           "band": "high", "detectorHit": False, "modelVersion": "bioclip2-vitl14-v1"})

    def evidence(self, blob):
        self.calls.append(("evidence", None))
        if self.missing_v2:
            raise EmbeddingsMissing("taxa_embeddings_v2.npy missing")
        return {"contract": 2, "candidates": [{"taicol_id": "t1", "score": 0.9}],
                "detectorHit": False, "modelVersion": "bioclip2-vitl14-v2", "speciesCount": 1}


IMAGE = "aGVsbG8="  # base64 of "hello"; the fake classifier never decodes it


def call(payload, clf=None, token="secret"):
    clf = clf or FakeClassifier()
    status, body = handle(payload, clf=clf, expected_token=token)
    return status, body, clf


class Endpoint(unittest.TestCase):
    def test_no_contract_is_answered_exactly_as_before(self):
        status, body, clf = call({"token": "secret", "imageBase64": IMAGE, "category": "roadkill"})
        self.assertEqual(status, 200)
        self.assertEqual(clf.calls, [("classify", "roadkill")])
        self.assertIn("predictions", body)
        self.assertNotIn("candidates", body)

    def test_contract_2_returns_evidence_and_never_a_band(self):
        status, body, clf = call({"token": "secret", "imageBase64": IMAGE, "contract": 2,
                                  "category": "invasive"})
        self.assertEqual(status, 200)
        self.assertEqual(clf.calls, [("evidence", None)])
        self.assertEqual(body["contract"], 2)
        self.assertNotIn("band", body)

    def test_contract_2_does_not_need_a_category_and_ignores_one(self):
        # The category is the website's business now. If it reached the model
        # it could narrow the list again, which is the defect this replaces.
        a = call({"token": "secret", "imageBase64": IMAGE, "contract": 2})
        b = call({"token": "secret", "imageBase64": IMAGE, "contract": 2, "category": "invasive"})
        self.assertEqual(a[0], 200)
        self.assertEqual(a[1], b[1])

    def test_the_legacy_contract_still_requires_a_category(self):
        status, _, clf = call({"token": "secret", "imageBase64": IMAGE})
        self.assertEqual(status, 400)
        self.assertEqual(clf.calls, [])

    def test_a_bad_token_learns_nothing_whatever_it_asks_for(self):
        for payload in (
            {"token": "nope", "category": "roadkill"},  # what scripts/preflight.ts sends
            {"token": "nope", "contract": 2, "imageBase64": IMAGE},
            {"token": "nope", "contract": 99},
            {"contract": 2, "imageBase64": IMAGE},
        ):
            status, _, clf = call(payload)
            self.assertEqual(status, 401, payload)
            self.assertEqual(clf.calls, [])

    def test_no_token_configured_refuses_everyone(self):
        status, _, _ = call({"token": "", "category": "roadkill", "imageBase64": IMAGE}, token="")
        self.assertEqual(status, 401)

    def test_an_unknown_contract_is_a_400_not_a_legacy_answer(self):
        status, body, clf = call({"token": "secret", "imageBase64": IMAGE, "contract": 3,
                                  "category": "roadkill"})
        self.assertEqual(status, 400)
        self.assertEqual(clf.calls, [])

    def test_missing_v2_files_are_a_503_and_leave_the_legacy_contract_working(self):
        clf = FakeClassifier(missing_v2=True)
        status, _, _ = call({"token": "secret", "imageBase64": IMAGE, "contract": 2}, clf=clf)
        self.assertEqual(status, 503)
        status, _, _ = call({"token": "secret", "imageBase64": IMAGE, "category": "roadkill"}, clf=clf)
        self.assertEqual(status, 200)

    def test_no_image_is_a_400(self):
        status, _, _ = call({"token": "secret", "contract": 2})
        self.assertEqual(status, 400)
        status, _, _ = call({"token": "secret", "contract": 2, "imageUrl": "https://example.invalid/x.jpg"})
        self.assertEqual(status, 400)

    # From the security audit of 29 September 2026: inputs that raised past
    # the handler and came back 500, which the website retries as an outage.

    def test_a_token_that_cannot_be_encoded_is_a_401_not_a_500(self):
        status, _, clf = call({"token": "\ud800", "imageBase64": IMAGE, "contract": 2})
        self.assertEqual(status, 401)
        self.assertEqual(clf.calls, [])

    def test_a_payload_that_is_not_an_object_is_a_401(self):
        for payload in ([], "token", None, 3):
            status, _, _ = call(payload)
            self.assertEqual(status, 401, payload)

    def test_malformed_fields_are_400s(self):
        for payload in (
            {"token": "secret", "imageBase64": 123, "contract": 2},
            {"token": "secret", "imageBase64": IMAGE, "category": ["roadkill"]},
            {"token": "secret", "imageBase64": IMAGE, "contract": [2]},
            {"token": "secret", "imageBase64": "!!!", "contract": 2},
        ):
            status, _, clf = call(payload)
            self.assertEqual(status, 400, payload)
            self.assertEqual(clf.calls, [], payload)

    def test_an_image_past_the_upload_cap_is_refused_before_decoding(self):
        status, body, clf = call({"token": "secret", "contract": 2, "imageBase64": "A" * 14_000_004})
        self.assertEqual(status, 400)
        self.assertEqual(body["detail"], "image too large")
        self.assertEqual(clf.calls, [])

    def test_the_token_is_checked_before_the_shape(self):
        # parse() runs in the CPU container; nothing reaches the GPU without it.
        self.assertEqual(parse({"contract": 99}, expected_token="secret"), (401, {"detail": "unauthorized"}))
        self.assertEqual(parse({"token": "secret"}, expected_token=None), (401, {"detail": "unauthorized"}))
        req = parse({"token": "secret", "imageBase64": IMAGE, "contract": 2}, expected_token="secret")
        self.assertIsInstance(req, Request)
        self.assertEqual(req.blob, b"hello")


ROW_DEFAULTS = {
    "is_invasive": False,
    "has_invasive_infraspecific": False,
    "is_marine": None,
    "is_terrestrial": None,
    "is_protected": False,
    "recorded_on_roads": False,
}


class SharedProfileCases(unittest.TestCase):
    """evaluate.py fits the thresholds with its own copy of the website's rules.

    The same cases run against lib/report/classifyPolicy.ts in
    apps/web/test/classify-evidence.test.mjs. If the two copies drifted apart,
    the committed thresholds would have been fitted on candidates the website
    never picks.
    """

    def test_every_shared_case(self):
        import json

        import evaluate

        cases = json.loads((pathlib.Path(__file__).parent / "testdata" / "profile_cases.json").read_text())["cases"]
        self.assertGreater(len(cases), 5)
        for case in cases:
            with self.subTest(case["name"]):
                rows = {}
                for i, c in enumerate(case["candidates"]):
                    rows[c["taicol_id"]] = {**ROW_DEFAULTS, "id": i + 1,
                                            **{k: v for k, v in c.items() if k != "score"}}
                ev = [{"taicol_id": c["taicol_id"], "score": c["score"]} for c in case["candidates"]]
                profile = evaluate.PROFILE_OF_CATEGORY[case["category"]]
                pool = evaluate.pool_for(profile, ev, rows)
                best = pool[0] if pool else None
                self.assertEqual(best["taicol_id"] if best else None, case["expect"]["best"])
                verdict = evaluate.invasive_verdict(best) if profile == "invasive" else None
                self.assertEqual(verdict, case["expect"]["invasive"])
                if best:
                    # Never re-normalised: the score is the model's own.
                    self.assertEqual(best["score"], next(c["score"] for c in ev if c["taicol_id"] == best["taicol_id"]))


class SharedGuardCases(unittest.TestCase):
    def test_every_guard_case(self):
        import json

        import evaluate

        cases = json.loads((pathlib.Path(__file__).parent / "testdata" / "profile_cases.json").read_text())["guardCases"]
        self.assertTrue(any(c["blocked"] for c in cases) and not all(c["blocked"] for c in cases))
        for case in cases:
            with self.subTest(case["name"]):
                pool = [{**ROW_DEFAULTS, "kingdom": "Animalia", "class": "Aves", **c} for c in case["candidates"]]
                blur_of = {c["taicol_id"]: c["blur"] for c in case["candidates"]}
                self.assertEqual(evaluate.congener_guard(pool, blur_of) is not None, case["blocked"])


class Wilson(unittest.TestCase):
    def test_known_values(self):
        import evaluate

        lo, hi = evaluate.wilson(74, 74)
        self.assertAlmostEqual(lo, 0.9507, places=3)
        self.assertEqual(hi, 1.0)
        lo, hi = evaluate.wilson(0, 4)
        self.assertEqual(lo, 0.0)
        self.assertAlmostEqual(hi, 0.4899, places=3)

    def test_the_strict_fit_needs_the_lower_bound_to_clear_the_target(self):
        # 20 right then 1 wrong, repeated: point precision ~95% everywhere,
        # but never proven to be at least 95%.
        import evaluate

        hits = np.array(([1] * 19 + [0]) * 10, dtype=bool)
        scores = np.linspace(1.0, 0.5, len(hits))
        fit = evaluate.fit_high(scores, hits, 0.95)
        self.assertIsNone(fit["strict"])
        self.assertIsNotNone(fit["pointEstimate"])


if __name__ == "__main__":
    unittest.main()
