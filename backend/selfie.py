"""A selfie with the avatar, handed to the visitor's phone.

The picture is made in the browser: the camera frame, with the avatar cut out
of their own footage and stood in front of it. Nothing reaches this module
unless the visitor presses "share to my phone" — and then it has to be held
somewhere a phone can fetch it from, which is the one thing here that try-on
never does.

**Held in memory, never on disk.** The rule this project already has is that a
visitor's photograph is not written to disk: not a temp file, not a cache, not
the event log. Sharing does not need to break it. A photo lives in this
process for a day, behind an address nobody can guess, and is gone at the
first of: its expiry, the store filling up, or the process stopping. The event
log records that a selfie was shared, and never the selfie.

Shared code: imports nothing that needs a model, so the cloud role can hold
them too.
"""

import secrets
import threading
import time
import urllib.parse
from pathlib import Path

from backend import config

ROOT = Path(__file__).resolve().parent.parent

#: What the screen promises: deleted after 24 hours.
TTL = 24 * 60 * 60

#: A composed 1440x2160 JPEG is about a megabyte. Past this it is not one of
#: ours, and a public route must not be a way to park files here.
MAX_IMAGE = 3 * 1024 * 1024

#: Bounded, because this is memory — and because the route is open to whoever
#: reaches the port, so the two limits together are the most it can be made to
#: hold: 120 MB. The oldest goes first.
#: ponytail: a busy cabinet evicts before the day is out, and a restart forgets
#: them all. Object storage with a lifecycle rule, behind `hold`/`fetch`, the
#: day either is reported by somebody who scanned too late.
MAX_HELD = 40

_held: dict[str, tuple[float, bytes, str]] = {}
_lock = threading.Lock()

_KINDS = ((b"\xff\xd8\xff", "image/jpeg"), (b"\x89PNG\r\n\x1a\n", "image/png"))


def hold(image: bytes) -> str:
    """Keep one photograph for a day. Returns the address it is fetched by.

    The address is the only credential — 128 random bits, the same shape as an
    avatar id being unguessable because it is a bearer token.
    """
    if not image:
        raise ValueError("there is no photograph here")
    if len(image) > MAX_IMAGE:
        raise ValueError("that photograph is too large")
    kind = next((media for magic, media in _KINDS if image.startswith(magic)), "")
    if not kind:
        raise ValueError("that is not a photograph")

    now = time.monotonic()
    token = secrets.token_urlsafe(16)
    with _lock:
        _expire(now)
        while len(_held) >= MAX_HELD:
            del _held[min(_held, key=lambda held: _held[held][0])]
        _held[token] = (now, image, kind)
    return token


def fetch(token: str) -> tuple[bytes, str] | None:
    """The photograph and its media type, or None once it is gone."""
    with _lock:
        _expire(time.monotonic())
        found = _held.get(token)
    return (found[1], found[2]) if found else None


def _expire(now: float) -> None:
    for token, (at, _, _) in list(_held.items()):
        if now - at > TTL:
            del _held[token]


_LOOPBACK = {"localhost", "127.0.0.1", "::1", ""}


def public_base(asked_at: str = "") -> str:
    """Where a phone can reach this cabinet, or "" if nowhere.

    A QR code is only as good as the address in it. The panel talks to
    `localhost`, which on a visitor's phone is the phone. In order:

    - `LUXORA_PUBLIC_URL`, when somebody has said what the address is;
    - the address this request arrived at, when that is not the machine itself
      — the panel opened over the tunnel or the shop's network;
    - the tunnel `start.ps1` opens at every logon, which writes its link to
      `tunnel-url.txt`.

    ponytail: that file is whatever the last start wrote. A tunnel that has
    since dropped leaves a link that goes nowhere, and the visitor's scan
    fails. Set `LUXORA_PUBLIC_URL` to a stable hostname before a real showroom.
    """
    if config.PUBLIC_URL:
        return config.PUBLIC_URL.rstrip("/")
    if asked_at:
        parsed = urllib.parse.urlparse(asked_at)
        if (parsed.hostname or "") not in _LOOPBACK:
            return f"{parsed.scheme}://{parsed.netloc}"
    try:
        link = (ROOT / "tunnel-url.txt").read_text(encoding="ascii").strip()
    except (OSError, UnicodeDecodeError):
        return ""
    return link.rstrip("/") if link.startswith("https://") else ""


def status(asked_at: str = "") -> dict:
    """Whether to offer a selfie at all, and whether it can go to a phone.

    Two answers, because they fail differently: without `share` the selfie
    still works and stays on the screen, and the button that could only fail
    is not drawn.
    """
    return {
        "available": config.SELFIE_ENABLED,
        "share": config.SELFIE_ENABLED and bool(public_base(asked_at)),
    }
