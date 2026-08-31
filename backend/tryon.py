"""Virtual try-on — a photograph of a visitor, wearing a garment from the catalog.

The scope document places this last, on the assumption it sits on the digital
human. It does not. Try-on is asynchronous — a photo in, a photo out, ten seconds
is fine — so it touches nothing in the conversation stack: not the event bus, not
the renderer, not barge-in. That is why it is a module of its own with a seam of
its own, in the same shape as `avatar_provider.py`.

**A kiosk that photographs members of the public is a different legal object from
one that answers questions.** Under India's DPDP Act and the GDPR that needs an
answer before the first demo, not after, so the rules are enforced here rather
than left to whoever writes the next UI:

- Nothing runs without explicit consent passed on the request.
- The photograph is held in memory and never written to disk — not as a temp
  file, not as a cache, not in the event log.
- The event log records *that* a try-on happened and for which product. It never
  records the image, and there is no code path that could.
- A local provider keeps the image inside the cabinet entirely, which is the real
  argument for running this on the Mac mini rather than in someone's cloud.

Deliberately not a stub that returns nothing. An unconfigured provider says
exactly which key is missing, because a silent no-op in an image pipeline is
debugged by staring at a blank rectangle.
"""

import base64
import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Protocol

from pathlib import Path

from backend import config

ROOT = Path(__file__).resolve().parent.parent

TIMEOUT = 20
#: Diffusion on a garment swap is 10–30s. Past a minute a visitor has walked away,
#: and holding the connection open past that is holding it open for nobody.
MAX_WAIT = 90

#: Bigger than any phone photo we would want to send, small enough that a kiosk
#: cannot be used to push files through the platform.
MAX_IMAGE = 12 * 1024 * 1024


class TryOnUnavailable(RuntimeError):
    """No provider configured, or the configured one refused."""


class ConsentMissing(RuntimeError):
    """Raised rather than defaulted. A missing consent flag is a bug in the caller
    and must never be read as agreement."""


@dataclass
class Result:
    image: bytes
    media_type: str = "image/png"
    provider: str = ""
    seconds: float = 0.0


class TryOnProvider(Protocol):
    name: str

    def available(self) -> bool: ...

    def swap(self, person: bytes, garment_url: str, description: str) -> Result: ...


def _data_uri(image: bytes) -> str:
    """The visitor's photo as a data URI.

    Uploading it to object storage first would be the conventional way to hand an
    image to a hosted model, and it would mean a copy of a member of the public's
    photograph sitting in a bucket with its own lifecycle, its own access policy
    and its own deletion problem. Inline, it exists for one request.
    """
    kind = "image/png" if image[:4] == b"\x89PNG" else "image/jpeg"
    return f"data:{kind};base64,{base64.b64encode(image).decode()}"


def garment_source(image: str) -> str:
    """The garment, in a form the provider can actually read.

    A catalog's `image` is whatever the customer's export contained. When it is a
    public `https://` URL the provider fetches it and there is nothing to do.
    When it is a path served by this machine — `/avatars/...`, `/products/...`,
    or anything the kiosk serves itself — the provider cannot reach it, because
    a showroom kiosk is not on the public internet and a laptop running this on
    localhost certainly is not.

    That would make try-on impossible to demonstrate anywhere except a deployed
    install with public asset hosting, which is a strange place to discover the
    feature does not work. So a local path is read off disk and inlined the same
    way the visitor's photograph is.
    """
    if image.startswith(("http://", "https://", "data:")):
        return image

    # Served from frontend/public in dev and frontend/dist once built; the built
    # copy wins because that is what the running kiosk is serving.
    roots = [
        ROOT / "frontend" / "dist",          # shipped with the code
        config.DATA / "frontend" / "public", # uploaded by the customer
    ]
    relative = image.lstrip("/")
    for root in roots:
        candidate = (root / relative).resolve()
        # A catalog is customer-supplied data, so an `image` of "../../.env" is a
        # file read primitive if the path is trusted. Confine it to the folder.
        if not candidate.is_relative_to(root.resolve()):
            continue
        if candidate.is_file():
            return _data_uri(candidate.read_bytes())

    raise TryOnUnavailable(
        f"the image for this product ({image}) is not a public URL and was not "
        f"found on this machine, so there is nothing to put on anyone"
    )


def _post(url: str, payload: dict, headers: dict) -> dict:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", **headers},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        return json.loads(response.read())


def _get(url: str, headers: dict) -> dict:
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        return json.loads(response.read())


def _download(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "Luxora/1.0"})
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        return response.read()


class ReplicateProvider:
    """IDM-VTON on Replicate. Pay per second, no machine to keep warm.

    The model version is configurable because a pinned hash goes stale and the
    failure — a 422 from a vendor — reads like our bug rather than a moved model.
    """

    name = "replicate"

    def available(self) -> bool:
        return bool(config.REPLICATE_API_TOKEN)

    def swap(self, person: bytes, garment_url: str, description: str) -> Result:
        if not self.available():
            raise TryOnUnavailable("set REPLICATE_API_TOKEN to enable try-on")

        started = time.monotonic()
        headers = {"Authorization": f"Bearer {config.REPLICATE_API_TOKEN}"}
        try:
            prediction = _post(
                "https://api.replicate.com/v1/predictions",
                {
                    "version": config.TRYON_MODEL_REPLICATE,
                    "input": {
                        "human_img": _data_uri(person),
                        "garm_img": garment_source(garment_url),
                        "garment_des": description or "garment",
                    },
                },
                headers,
            )
        except urllib.error.HTTPError as exc:
            raise TryOnUnavailable(f"Replicate refused the request ({exc.code})") from exc
        except urllib.error.URLError as exc:
            raise TryOnUnavailable("could not reach Replicate") from exc

        url = prediction.get("urls", {}).get("get", "")
        while prediction.get("status") in ("starting", "processing"):
            if time.monotonic() - started > MAX_WAIT:
                raise TryOnUnavailable("try-on took too long — the visitor has gone")
            time.sleep(1.5)
            prediction = _get(url, headers)

        if prediction.get("status") != "succeeded":
            raise TryOnUnavailable(prediction.get("error") or "the model could not use that photo")

        output = prediction.get("output")
        image_url = output[0] if isinstance(output, list) else output
        if not image_url:
            raise TryOnUnavailable("the model returned nothing")

        return Result(_download(image_url), "image/png", self.name, time.monotonic() - started)


class FalProvider:
    """The same model on fal.ai. Usually faster to first frame; same contract."""

    name = "fal"

    def available(self) -> bool:
        return bool(config.FAL_KEY)

    def swap(self, person: bytes, garment_url: str, description: str) -> Result:
        if not self.available():
            raise TryOnUnavailable("set FAL_KEY to enable try-on")

        started = time.monotonic()
        headers = {"Authorization": f"Key {config.FAL_KEY}"}
        endpoint = config.TRYON_MODEL_FAL
        try:
            queued = _post(
                f"https://queue.fal.run/{endpoint}",
                {
                    "human_image_url": _data_uri(person),
                    "garment_image_url": garment_source(garment_url),
                    "description": description or "garment",
                },
                headers,
            )
        except urllib.error.HTTPError as exc:
            raise TryOnUnavailable(f"fal.ai refused the request ({exc.code})") from exc
        except urllib.error.URLError as exc:
            raise TryOnUnavailable("could not reach fal.ai") from exc

        status_url = queued.get("status_url", "")
        response_url = queued.get("response_url", "")
        status = queued.get("status", "IN_QUEUE")

        while status in ("IN_QUEUE", "IN_PROGRESS"):
            if time.monotonic() - started > MAX_WAIT:
                raise TryOnUnavailable("try-on took too long — the visitor has gone")
            time.sleep(1.5)
            status = _get(status_url, headers).get("status", "")

        if status != "COMPLETED":
            raise TryOnUnavailable("the model could not use that photo")

        payload = _get(response_url, headers)
        image = payload.get("image") or {}
        image_url = image.get("url") if isinstance(image, dict) else image
        if not image_url:
            raise TryOnUnavailable("the model returned nothing")

        return Result(_download(image_url), "image/png", self.name, time.monotonic() - started)


class LocalProvider:
    """A garment-swap model on the machine itself.

    Not implemented, and refusing is the honest state. On an M4 Pro this is the
    right answer — IDM-VTON, OOTDiffusion and CatVTON all run locally because
    10–30 seconds per image is acceptable here, and the visitor's photograph then
    never leaves the cabinet. The reason it is not wired is that nobody has run
    the spike, not that the approach is wrong.
    """

    name = "local"

    def available(self) -> bool:
        return False

    def swap(self, person: bytes, garment_url: str, description: str) -> Result:
        raise TryOnUnavailable(
            "local try-on is not wired up. It is the preferred option — the photo "
            "never leaves the cabinet — but the model has not been benchmarked on "
            "this hardware. Set REPLICATE_API_TOKEN or FAL_KEY meanwhile."
        )


_PROVIDERS: dict[str, TryOnProvider] = {
    "local": LocalProvider(),
    "replicate": ReplicateProvider(),
    "fal": FalProvider(),
}


def provider() -> TryOnProvider:
    """The configured provider, or the first usable one.

    Falling through rather than failing means a company that set one key gets
    try-on without also having to name it.
    """
    named = _PROVIDERS.get(config.TRYON_PROVIDER)
    if named and named.available():
        return named
    for candidate in _PROVIDERS.values():
        if candidate.available():
            return candidate
    return _PROVIDERS["local"]  # Refuses, and says what is missing.


def available() -> bool:
    return provider().available()


def status() -> dict:
    return {
        "available": available(),
        "provider": provider().name,
        "options": [name for name, p in _PROVIDERS.items() if p.available()],
        # The UI shows this before opening a camera. A person deciding whether to
        # be photographed is entitled to know whether the image leaves the room.
        "on_device": provider().name == "local",
    }


def try_on(person: bytes, garment_url: str, description: str = "", consent: bool = False) -> Result:
    """The whole feature. Consent is a parameter with no default of `True`."""
    if not consent:
        raise ConsentMissing("try-on needs explicit consent from the person in the photo")
    if not person:
        raise ValueError("no photo")
    if len(person) > MAX_IMAGE:
        raise ValueError("that photo is too large")
    if not garment_url:
        raise TryOnUnavailable("this product has no image to put on anyone")
    return provider().swap(person, garment_url, description)
