"""Modal deployment of the species classifier.

    modal deploy apps/ml/modal_app.py

Scale-to-zero, so idle cost is zero — which is the right shape for a citizen
science project with bursty, low-volume traffic. Cold start is ~15s, invisible
because classification is asynchronous: a report is submitted, held, and published
once the worker has an answer.

Weights are baked into the image at build time. Downloading them at runtime would
turn a 15s cold start into minutes.
"""

from __future__ import annotations

import os

import modal

MODEL_HUB = "imageomics/bioclip-2"

image = (
    modal.Image.debian_slim(python_version="3.12")
    # Deliberately lean. PytorchWildlife is NOT installed: its package __init__
    # eagerly imports a bioacoustics module, pulling soundfile + librosa + gradio
    # + roboflow into an image-only task. The detector (off by default, see
    # pipeline.py) loads MegaDetector weights through `ultralytics` instead.
    .pip_install(
        "torch>=2.4",
        "torchvision>=0.19",
        "open_clip_torch>=2.24",
        "pillow>=10.3",
        "numpy>=1.26",
        # Required by @modal.fastapi_endpoint. It used to arrive transitively via
        # PytorchWildlife; now that the image is lean it must be explicit.
        "fastapi[standard]",
        "requests>=2.32",
    )
    # Bake BioCLIP 2 into the image rather than fetching on first request.
    .run_commands(
        "python -c \"import open_clip; open_clip.create_model_and_transforms('hf-hub:%s')\"" % MODEL_HUB
    )
    .add_local_dir(
        os.path.join(os.path.dirname(__file__)),
        remote_path="/app",
        ignore=["~*", ".venv", "__pycache__"],
    )
)

app = modal.App("conservation-classifier", image=image)

# The embedding matrix lives in a Volume rather than the image: it is rebuilt
# whenever the checklist changes, and a Volume update does not require an image
# rebuild. Populate with `modal volume put`.
embeddings = modal.Volume.from_name("conservation-embeddings", create_if_missing=True)


@app.cls(
    gpu="T4",
    volumes={"/data/embeddings": embeddings},
    scaledown_window=60,
    secrets=[modal.Secret.from_name("conservation-ml")],
    max_containers=4,
)
class Service:
    @modal.enter()
    def load(self):
        import sys

        sys.path.insert(0, "/app")
        os.environ.setdefault("ML_DEVICE", "cuda")
        # The Volume is mounted here; pipeline.py reads ML_DATA_DIR.
        os.environ.setdefault("ML_DATA_DIR", "/data/embeddings")
        from pipeline import Classifier

        self.clf = Classifier()

    @modal.fastapi_endpoint(method="POST", docs=False)
    def classify(self, payload: dict):
        """Authenticated classify endpoint.

        Expects {"token", "imageUrl" | "imageBase64", "category"}. The shared
        token keeps this from being an open image-classification service that
        anyone can run up a GPU bill on.
        """
        import base64

        import requests
        from fastapi import HTTPException

        expected = os.environ.get("ML_ENDPOINT_TOKEN")
        if not expected or payload.get("token") != expected:
            raise HTTPException(status_code=401, detail="unauthorized")

        category = payload.get("category")
        if not category:
            raise HTTPException(status_code=400, detail="category required")

        if payload.get("imageBase64"):
            blob = base64.b64decode(payload["imageBase64"])
        elif payload.get("imageUrl"):
            r = requests.get(payload["imageUrl"], timeout=30)
            if r.status_code != 200:
                raise HTTPException(status_code=400, detail=f"image fetch failed ({r.status_code})")
            blob = r.content
        else:
            raise HTTPException(status_code=400, detail="imageUrl or imageBase64 required")

        try:
            return self.clf.classify(blob, category).to_dict()
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
