"""detect -> crop -> embed -> rank.

The detector is deliberately **advisory, never gating**. MegaDetector is trained
on camera-trap mammals, birds and vehicles; it does not know 福壽螺 (apple snail),
紅火蟻 (fire ants), 小花蔓澤蘭 (a vine), or most lizards — which are precisely the
invasive species this project most needs to identify. So when there is no animal
detection we classify the whole image and record `detector_hit=False`, rather than
rejecting the photo.

CROPPING IS OFF BY DEFAULT, AND THAT IS AN EVIDENCE-BASED DECISION.

The original argument for it was that a roadkill photo is mostly asphalt with a
small carcass, so an uncropped classifier ends up classifying *road*. Measured on
the eval set (308 images, 2026-08-05), cropping did the opposite:

    detector off   top-1 60.8%   top-5 91.5%   33.3% auto-identified
    detector on    top-1 61.0%   top-5 87.0%   25.3% auto-identified

Detection itself works fine (10/12 images, one crop reducing area 13x). The
problem is the eval set: iNaturalist photos are of live, well-framed animals that
already fill the frame, so cropping only strips context BioCLIP uses — habitat,
posture, scale — while removing no distracting background, because there isn't
any.

That means this measurement does NOT refute the roadkill argument; it simply
cannot test it, because the eval set contains no roadkill photography. The
question stays open until there are real roadkill photos to measure against,
which is what the site's own submissions will eventually provide. Until then,
shipping the configuration that measures better is the honest default.

Set ML_USE_DETECTOR=1 to enable it and re-run evaluate.py to compare.
"""

from __future__ import annotations

import io
import os
import pathlib
from dataclasses import dataclass, asdict

import numpy as np
from PIL import Image

from bioclip import encode_image, logit_scale, MODEL_VERSION, EMBED_VERSION
from labelsets import LabelSets, CLASSIFIABLE

# Repo-relative locally; overridden in the Modal container, where the code lives
# at /app and the embeddings are mounted from a Volume at /data/embeddings.
# (Deriving it from __file__ inside the container raises IndexError — /app has
# only two parents.)
DATA_DIR = pathlib.Path(
    os.environ.get("ML_DATA_DIR")
    or pathlib.Path(__file__).resolve().parents[2] / "data" / "embeddings"
)

# Bands for turning a softmax score into an action.
#
# BAND_HIGH is MEASURED, not guessed: evaluate.py fitted it against 306 labelled
# Taiwan images (2026-08-04, bioclip2-vitl14-v1, 70,805 candidate taxa).
#
#   top-1 accuracy            60.8%
#   top-5 accuracy            91.5%
#   at score >= 0.73          90.2% precision, covering 33% of images
#
# So a third of photos get auto-identified at ~90% precision and the rest fall to
# user confirmation, where top-5 at 91.5% means the right answer is nearly always
# in the offered list. Re-run evaluate.py whenever the model or checklist changes.
#
# Caveat carried from the eval set: those images are live, well-framed iNaturalist
# photos, so this is an optimistic upper bound for actual roadkill conditions.
# BAND_MEDIUM is fitted too, and against a *different* criterion, because it does
# a different job: nothing is auto-assigned in the medium band. It only decides
# whether the reporter is shown a top-5 list to confirm, so what matters is
# whether the right answer is in that list — top-5, not top-1.
#
# Measured 2026-08-05 over the same 308 images, as local top-5 accuracy in bins of
# 25 (`evaluate.py --from-dump data/evalset/scores.json`):
#
#   scores [0.064, 0.271]   top-5  68.0%     <- list is materially worse here
#   scores [0.275, 0.363]   top-5  84.0%
#   scores [0.364, 0.435]   top-5  76.0%
#   everything above        top-5  92-100%
#
# So 0.28 is a real inflection, and the previous guess of 0.35 was measurably too
# high: it discarded a band whose top-5 is 84% correct, showing those reporters no
# list at all. Resulting behaviour — high 33.8% of images (top-1 90.4%), medium
# 58.1% (top-5 91.6%), low 8.1% (top-5 68.0%).
#
# The cutoff must be fitted locally, not cumulatively. Overall top-5 is ~92%, so a
# cumulative criterion stays above any sane target all the way down to the lowest
# score in the set and would answer "never withhold the list" regardless of the
# data. Caveat: only 25 images fall below 0.28, so treat the exact value as
# provisional.
BAND_HIGH = 0.73
BAND_MEDIUM = 0.28


@dataclass
class Prediction:
    taxon_id: int
    score: float
    rank: int


@dataclass
class Result:
    predictions: list[Prediction]
    detector_hit: bool
    band: str  # high | medium | low
    model_version: str

    def to_dict(self) -> dict:
        return {
            "predictions": [asdict(p) for p in self.predictions],
            "detectorHit": self.detector_hit,
            "band": self.band,
            "modelVersion": self.model_version,
        }


# MegaDetector v6, compact variant. Published on Zenodo as a plain YOLO
# checkpoint, so it loads through `ultralytics` directly.
#
# Deliberately NOT via the PytorchWildlife wrapper: its package __init__ eagerly
# imports a bioacoustics module, which drags soundfile + librosa + an audio stack
# into what is purely an image-detection task, on top of gradio and roboflow.
MD_WEIGHTS_URL = "https://zenodo.org/records/15398270/files/MDV6-yolov10-c.pt"
MD_WEIGHTS_PATH = DATA_DIR.parent / "models" / "MDV6-yolov10-c.pt"


def _load_detector():
    """MegaDetector if enabled and available, else None. Off by default — see the
    module docstring for the measurement behind that default."""
    if os.environ.get("ML_USE_DETECTOR", "").lower() not in {"1", "true", "yes"}:
        return None
    try:
        from ultralytics import YOLO  # type: ignore

        if not MD_WEIGHTS_PATH.exists():
            import urllib.request

            MD_WEIGHTS_PATH.parent.mkdir(parents=True, exist_ok=True)
            urllib.request.urlretrieve(MD_WEIGHTS_URL, MD_WEIGHTS_PATH)
        return YOLO(str(MD_WEIGHTS_PATH))
    except Exception as exc:  # noqa: BLE001 - detection is optional by design
        print(f"[pipeline] detector unavailable: {type(exc).__name__}: {exc}")
        return None


class Classifier:
    def __init__(self) -> None:
        emb_path = DATA_DIR / f"taxa_embeddings_{EMBED_VERSION}.npy"
        ids_path = DATA_DIR / f"taxa_ids_{EMBED_VERSION}.npy"
        meta_path = DATA_DIR / f"taxa_meta_{EMBED_VERSION}.json"
        if not emb_path.exists():
            raise SystemExit(f"{emb_path} missing — run build_embeddings.py first")

        # float16 on disk, float32 in memory: the matmul is trivial either way and
        # float32 avoids precision surprises in the softmax.
        self.emb = np.load(emb_path).astype(np.float32)
        self.ids = np.load(ids_path)
        self.labels = LabelSets(meta_path, self.emb.shape[0])
        self.scale = logit_scale()
        self.detector = _load_detector()

    def _crop(self, img: Image.Image) -> tuple[Image.Image, bool]:
        if self.detector is None:
            return img, False
        try:
            results = self.detector.predict(img.convert("RGB"), verbose=False)
            if not results:
                return img, False
            boxes = getattr(results[0], "boxes", None)
            if boxes is None or len(boxes) == 0:
                return img, False

            xyxy = boxes.xyxy.cpu().numpy()
            classes = boxes.cls.cpu().numpy()
            conf = boxes.conf.cpu().numpy()

            # class 0 == animal in MegaDetector's label map (1=person, 2=vehicle).
            best, best_conf = None, 0.0
            for i in range(len(xyxy)):
                if int(classes[i]) == 0 and float(conf[i]) > best_conf:
                    best, best_conf = xyxy[i], float(conf[i])
            if best is None or best_conf < 0.2:
                return img, False

            x1, y1, x2, y2 = (float(v) for v in best[:4])
            # ~10% padding: BioCLIP benefits from a little surrounding context.
            pw, ph = (x2 - x1) * 0.10, (y2 - y1) * 0.10
            box = (
                max(0, int(x1 - pw)),
                max(0, int(y1 - ph)),
                min(img.width, int(x2 + pw)),
                min(img.height, int(y2 + ph)),
            )
            if box[2] - box[0] < 16 or box[3] - box[1] < 16:
                return img, False
            return img.crop(box), True
        except Exception:
            # A detector failure must never cost us the classification.
            return img, False

    def classify(self, image_bytes: bytes, category: str, top_k: int = 5) -> Result:
        if category not in CLASSIFIABLE:
            raise ValueError(f"category {category!r} is not classifiable")

        img = Image.open(io.BytesIO(image_bytes))
        img.load()
        crop, detector_hit = self._crop(img)

        feat = encode_image(crop)

        mask = self.labels.for_category(category)
        emb = self.emb if mask is None else self.emb[mask]
        ids = self.ids if mask is None else self.ids[mask]

        logits = self.scale * (emb @ feat)
        # Numerically stable softmax over the *restricted* set.
        logits -= logits.max()
        probs = np.exp(logits)
        probs /= probs.sum()

        k = min(top_k, probs.shape[0])
        top = np.argpartition(-probs, k - 1)[:k]
        top = top[np.argsort(-probs[top])]

        preds = [
            Prediction(taxon_id=int(ids[i]), score=float(probs[i]), rank=r + 1)
            for r, i in enumerate(top)
        ]
        best = preds[0].score if preds else 0.0
        band = "high" if best >= BAND_HIGH else "medium" if best >= BAND_MEDIUM else "low"

        return Result(
            predictions=preds,
            detector_hit=detector_hit,
            band=band,
            model_version=MODEL_VERSION,
        )
