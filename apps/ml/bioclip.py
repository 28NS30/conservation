"""Model loading and encoding helpers for BioCLIP 2.

BioCLIP is CLIP-style, which is the entire reason it was chosen: the candidate
label set is decided *at inference time*, so we can score an image against only
the ~66k species that actually occur in Taiwan (or the 274 known invasives) rather
than the 952k taxa the model was trained on. A fixed-head classifier such as
SpeciesNet or an iNat21 ViT cannot do this — its output space is frozen at
training time, and it will confidently return species that have never occurred
here.
"""

from __future__ import annotations

import functools
import os
from typing import Callable

import numpy as np
import torch
import open_clip
from PIL import Image

MODEL_HUB = "hf-hub:imageomics/bioclip-2"

# The embedding set build_embeddings.py writes, and the one the evidence
# contract (contract.py, "contract": 2) scores against: accepted Taiwan taxa
# only, keyed by TaiCOL id, subspecies kept as extra rows of their species.
EMBED_VERSION = "v2"
MODEL_VERSION = f"bioclip2-vitl14-{EMBED_VERSION}"

# The set the legacy contract still answers from, unchanged, until no deployed
# website asks for it. Its files are never rebuilt: a v1 row index is a
# `taxa.id`, and the website that reads v1 answers writes them straight into
# `classifications.taxon_id`.
LEGACY_EMBED_VERSION = "v1"
LEGACY_MODEL_VERSION = f"bioclip2-vitl14-{LEGACY_EMBED_VERSION}"


def pick_device() -> str:
    if torch.cuda.is_available():
        return "cuda"
    # Apple Silicon. Roughly an order of magnitude faster than CPU for ViT-L/14.
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


@functools.lru_cache(maxsize=1)
def load_model(device: str | None = None):
    """Load BioCLIP 2 once per process."""
    device = device or os.environ.get("ML_DEVICE") or pick_device()
    model, _, preprocess = open_clip.create_model_and_transforms(MODEL_HUB)
    tokenizer = open_clip.get_tokenizer(MODEL_HUB)
    model = model.to(device).eval()
    return model, preprocess, tokenizer, device


@torch.no_grad()
def encode_texts(
    prompts: list[str],
    batch_size: int = 256,
    on_progress: "Callable[[int, int, float], None] | None" = None,
) -> np.ndarray:
    """L2-normalised text embeddings, float32, shape (len(prompts), dim).

    `on_progress(done, total, elapsed)` is called per batch. Encoding the full
    Taiwan checklist is a multi-minute job; running it blind is how you end up
    unable to tell "slow" from "hung".
    """
    import time

    model, _, tokenizer, device = load_model()
    out = []
    t0 = time.time()
    for i in range(0, len(prompts), batch_size):
        toks = tokenizer(prompts[i : i + batch_size]).to(device)
        feats = model.encode_text(toks)
        feats = feats / feats.norm(dim=-1, keepdim=True)
        out.append(feats.float().cpu().numpy())
        if on_progress:
            on_progress(min(i + batch_size, len(prompts)), len(prompts), time.time() - t0)
    return np.concatenate(out, axis=0) if out else np.zeros((0, 768), dtype=np.float32)


@torch.no_grad()
def encode_image(img: Image.Image) -> np.ndarray:
    """L2-normalised image embedding, float32, shape (dim,)."""
    model, preprocess, _, device = load_model()
    tensor = preprocess(img.convert("RGB")).unsqueeze(0).to(device)
    feats = model.encode_image(tensor)
    feats = feats / feats.norm(dim=-1, keepdim=True)
    return feats.float().cpu().numpy()[0]


@torch.no_grad()
def logit_scale() -> float:
    """The model's learned temperature, used to turn cosine similarity into logits."""
    model, _, _, _ = load_model()
    return float(model.logit_scale.exp().item())
