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
        # Both embedding sets, whichever are on the volume. A missing set is
        # logged, not fatal: the contract it serves answers 503 and the other
        # keeps working, which is what lets v2 be uploaded before any website
        # asks for it (docs/ai-rollout.md).
        self.clf.preload()

    @modal.fastapi_endpoint(method="POST", docs=False)
    def classify(self, payload: dict):
        """Authenticated classify endpoint, two contracts side by side.

        {"token", "imageUrl" | "imageBase64", "category"}
            The legacy contract: the category's label list, a band, the top 5
            as v1 `taxa.id`s. What every website before ML_CONTRACT=2 sends.

        {"token", "imageUrl" | "imageBase64", "contract": 2}
            The evidence contract: the top 50 species over every accepted
            Taiwan taxon as {taicol_id, score}; the website applies the rules.

        The shared token keeps this from being an open image-classification
        service that anyone can run up a GPU bill on. The decisions live in
        endpoint.py, where they are tested without Modal.
        """
        import requests
        from fastapi import HTTPException

        from endpoint import handle

        def fetch(url: str) -> tuple[int, bytes]:
            r = requests.get(url, timeout=30)
            return r.status_code, r.content

        status, body = handle(
            payload,
            clf=self.clf,
            expected_token=os.environ.get("ML_ENDPOINT_TOKEN"),
            fetch_image=fetch,
        )
        if status != 200:
            raise HTTPException(status_code=status, detail=body.get("detail"))
        return body
