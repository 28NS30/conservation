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
from dataclasses import dataclass
from typing import Protocol

from contract import CONTRACT_LEGACY, ContractError, EmbeddingsMissing, requested_contract

# The website uploads at most 10 MB (MAX_UPLOAD_BYTES in packages/shared), and
# base64 is 4/3 of that. A request past it is not a photograph from the site.
MAX_BASE64_CHARS = 14_000_000


class _Result(Protocol):
    def to_dict(self) -> dict: ...


class ClassifierLike(Protocol):
    def classify(self, image_bytes: bytes, category: str) -> _Result: ...
    def evidence(self, image_bytes: bytes) -> dict: ...


@dataclass(frozen=True)
class Request:
    """A request that passed the token and the shape checks."""

    contract: int
    category: str | None
    blob: bytes


def authorized(payload: object, expected_token: str | None) -> bool:
    """Whether the request carries the shared token. Never raises.

    `str.encode` raises on a lone surrogate ("\\ud800"), which a JSON body can
    carry, and it did so before the comparison: an unauthenticated caller got
    a 500 instead of a 401 (security audit, 29 September 2026).
    """
    if not expected_token or not isinstance(payload, dict):
        return False
    token = payload.get("token")
    if not isinstance(token, str):
        return False
    try:
        return hmac.compare_digest(token.encode("utf-8"), expected_token.encode("utf-8"))
    except UnicodeEncodeError:
        return False


def parse(payload: object, *, expected_token: str | None) -> tuple[int, dict] | Request:
    """The request, or the (status, body) that refuses it.

    Order matters. The token is checked before anything else, so a caller
    without it learns nothing, not even which contracts exist. This runs in a
    small CPU container in front of the GPU one (modal_app.py): the GPU class
    used to hold the check itself, so every request, a tokenless one included,
    cold-started a T4 and kept it warm for a minute. scripts/preflight.ts sends
    a bad token to prove the endpoint is up, and that is cheap now.
    """
    if not authorized(payload, expected_token):
        return 401, {"detail": "unauthorized"}
    assert isinstance(payload, dict)

    try:
        contract = requested_contract(payload)
    except ContractError as e:
        return 400, {"detail": str(e)}

    # Only the legacy contract takes a category. The evidence contract ignores
    # one if sent: which species a page may be named as is the website's rule
    # now, and a category reaching the model is how the invasive page's closed
    # list happened.
    category = payload.get("category")
    if category is not None and not isinstance(category, str):
        return 400, {"detail": "category must be a string"}
    if contract == CONTRACT_LEGACY and not category:
        return 400, {"detail": "category required"}

    # Bytes only. The service used to fetch an `imageUrl` too, following
    # redirects to any host and reading the whole body into memory, which made
    # it a fetch proxy for anyone holding the token. The website has always
    # sent the bytes (classifyWorker.ts).
    image = payload.get("imageBase64")
    if not image:
        return 400, {"detail": "imageBase64 required"}
    if not isinstance(image, str):
        return 400, {"detail": "imageBase64 must be a string"}
    if len(image) > MAX_BASE64_CHARS:
        return 400, {"detail": "image too large"}
    try:
        blob = base64.b64decode(image, validate=True)
    except (binascii.Error, ValueError):
        return 400, {"detail": "imageBase64 is not base64"}
    return Request(contract=contract, category=category, blob=blob)


def run(req: Request, clf: ClassifierLike) -> tuple[int, dict]:
    """(HTTP status, JSON body) for a request that passed parse()."""
    try:
        if req.contract == CONTRACT_LEGACY:
            assert req.category is not None
            return 200, clf.classify(req.blob, req.category).to_dict()
        return 200, clf.evidence(req.blob)
    except EmbeddingsMissing as e:
        # 503, not 500: the service is up and the files are not. The website
        # retries, and the report is held rather than lost.
        return 503, {"detail": str(e)}
    except ValueError as e:
        # Includes a photograph with too many pixels (pipeline.py).
        return 400, {"detail": str(e)}
    except OSError as e:
        # PIL's "cannot identify image file" is an OSError. A photograph the
        # service cannot open is the caller's problem, not an outage.
        return 400, {"detail": f"not a readable image: {e}"}


def handle(payload: object, *, clf: ClassifierLike, expected_token: str | None) -> tuple[int, dict]:
    """(HTTP status, JSON body) for one request: parse, then run."""
    parsed = parse(payload, expected_token=expected_token)
    if isinstance(parsed, tuple):
        return parsed
    return run(parsed, clf)
