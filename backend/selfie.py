"""A selfie with a character, handed to the visitor's phone.

Two halves. The characters — who a visitor can be photographed with — are
folders on disk, like avatars and campaigns, and are further down. This half is
the photographs.

The picture is made in the browser: the camera frame, with the character's
cut-out picture stood in front of it. Nothing reaches this module unless the
visitor presses "share to my phone" — and then it has to be held somewhere a
phone can fetch it from, which is the one thing here that try-on never does.

**Held in memory, never on disk.** The rule this project already has is that a
visitor's photograph is not written to disk: not a temp file, not a cache, not
the event log. Sharing does not need to break it. A photo lives in this
process for a day, behind an address nobody can guess, and is gone at the
first of: its expiry, the store filling up, or the process stopping. The event
log records that a selfie was shared, and never the selfie.

Shared code: imports nothing that needs a model, so the cloud role can hold
them too.
"""

import json
import re
import secrets
import shutil
import threading
import time
import urllib.parse
from dataclasses import dataclass
from pathlib import Path

from backend import config, store

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


# --- who the visitor is photographed with ------------------------------------
#
# A selfie character: a name, a picture and a clip, in a folder of their own.
#
# Not an avatar. The first version of this hung the picture and the clip on the
# showroom's avatars, which made a selfie something an avatar *had* — and the
# selfie tab a second list of the same people. The selfie is a thing by itself:
# who is in the photograph need never have stood in the showroom, and deleting
# a showroom avatar must not take a photo booth with it.

#: Beside `avatars/` and `campaigns/`, and served the same way.
CHARACTERS_DIR = config.DATA / "frontend" / "public" / "selfies"

#: Them as the phone sees them, already cut out. Who the picture is made with.
PICTURE = "selfie.png"
#: Five or six seconds of getting ready, played once while the count runs.
CLIP = "selfie.mp4"

_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")


@dataclass
class Character:
    id: str
    name: str
    org_id: str
    picture: str = ""
    clip: str = ""


def character_dir(character_id: str) -> Path:
    """Where one character's files live. The id is checked here, once, because
    it arrives on a URL and becomes a path."""
    if not _ID.match(character_id or ""):
        raise ValueError(f"unusable selfie id: {character_id!r}")
    return CHARACTERS_DIR / character_id


def _read(folder: Path) -> Character:
    try:
        meta = json.loads((folder / "character.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        meta = {}

    def served(name: str) -> str:
        file = folder / name
        # The address changes when the file does. Replacing a picture keeps its
        # name, and a browser shown the same address shows the picture it had.
        return f"/selfies/{folder.name}/{name}?v={int(file.stat().st_mtime)}" if file.exists() else ""

    return Character(
        id=folder.name,
        name=meta.get("name") or folder.name,
        org_id=meta.get("org_id") or store.DEFAULT_ORG,
        picture=served(PICTURE),
        clip=served(CLIP),
    )


def characters(org_id: str) -> list[Character]:
    """One company's selfie characters, by name."""
    if not CHARACTERS_DIR.is_dir():
        return []
    found = [_read(f) for f in CHARACTERS_DIR.iterdir() if f.is_dir() and _ID.match(f.name)]
    return sorted((c for c in found if c.org_id == org_id), key=lambda c: c.name.lower())


def character(character_id: str) -> Character | None:
    try:
        folder = character_dir(character_id)
    except ValueError:
        return None
    return _read(folder) if folder.is_dir() else None


def create_character(name: str, org_id: str) -> Character:
    """A new one, empty. Its id ends in six random characters for the reason an
    avatar's does: the public selfie screen is opened by it, so it is a bearer
    credential, and a slug of the name is free to guess."""
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40] or "selfie"
    folder = character_dir(f"{slug}-{secrets.token_hex(3)}")
    folder.mkdir(parents=True)
    (folder / "character.json").write_text(
        json.dumps({"name": name, "org_id": org_id}, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return _read(folder)


def delete_character(character_id: str) -> None:
    shutil.rmtree(character_dir(character_id), ignore_errors=True)


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
