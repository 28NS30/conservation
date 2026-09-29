"""The classify endpoint's request handling, without Modal or FastAPI.

modal_app.py wraps this in a web endpoint; test_contract.py calls it with a
stand-in classifier, because CI has no GPU, no Modal account and no torch.
Keeping the decisions here is what lets a test prove the two contracts are
served side by side: which one a request gets, and that the legacy one is
still what a request that says nothing gets.
"""

from __future__ import annotations

import base64
import binascii
import hmac
from typing import Callable, Protocol

from contract import CONTRACT_LEGACY, ContractError, EmbeddingsMissing, requested_contract


class _Result(Protocol):
    def to_dict(self) -> dict: ...


class ClassifierLike(Protocol):
    def classify(self, image_bytes: bytes, category: str) -> _Result: ...
    def evidence(self, image_bytes: bytes) -> dict: ...


def handle(
    payload: dict,
    *,
    clf: ClassifierLike,
    expected_token: str | None,
    fetch_image: Callable[[str], tuple[int, bytes]],
) -> tuple[int, dict]:
    """(HTTP status, JSON body) for one request.

    Order matters. The token is checked before anything else, so a caller
    without it learns nothing, not even which contracts exist, and cannot make
    the service fetch a URL or wake a GPU. scripts/preflight.ts relies on this:
    it sends a bad token to prove the endpoint is up without paying for a cold
    start.
    """
    token = payload.get("token")
    if not expected_token or not isinstance(token, str) or not hmac.compare_digest(
        token.encode(), expected_token.encode()
    ):
        return 401, {"detail": "unauthorized"}

    try:
        contract = requested_contract(payload)
    except ContractError as e:
        return 400, {"detail": str(e)}

    # Only the legacy contract takes a category. The evidence contract ignores
    # one if sent: which species a page may be named as is the website's rule
    # now, and a category reaching the model is how the invasive page's closed
    # list happened.
    category = payload.get("category")
    if contract == CONTRACT_LEGACY and not category:
        return 400, {"detail": "category required"}

    if payload.get("imageBase64"):
        try:
            blob = base64.b64decode(payload["imageBase64"])
        except (binascii.Error, ValueError):
            return 400, {"detail": "imageBase64 is not base64"}
    elif payload.get("imageUrl"):
        status, blob = fetch_image(payload["imageUrl"])
        if status != 200:
            return 400, {"detail": f"image fetch failed ({status})"}
    else:
        return 400, {"detail": "imageUrl or imageBase64 required"}

    try:
        if contract == CONTRACT_LEGACY:
            return 200, clf.classify(blob, category).to_dict()
        return 200, clf.evidence(blob)
    except EmbeddingsMissing as e:
        # 503, not 500: the service is up and the files are not. The website
        # retries, and the report is held rather than lost.
        return 503, {"detail": str(e)}
    except ValueError as e:
        return 400, {"detail": str(e)}
    except OSError as e:
        # PIL's "cannot identify image file" is an OSError. A photograph the
        # service cannot open is the caller's problem, not an outage.
        return 400, {"detail": f"not a readable image: {e}"}
