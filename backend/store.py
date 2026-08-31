"""Avatars and kiosks.

File-backed today: an avatar is a folder under `frontend/public/avatars/<id>/`
holding its media and an `avatar.json`. That is enough to support several avatars,
several kiosks, several companies and the studio UI without a database server.

Tenancy is an `org_id` on each record. `list_avatars(None)` means *no tenant
filter* and exists for the kiosk path, which resolves an avatar by id before it
knows any org; every studio caller passes one. The difference is deliberate and
is the only place in the codebase where "unscoped" is a legitimate answer.

When Supabase arrives it replaces this module and nothing else — the rest of the
app only ever sees `Avatar`, `Kiosk` and the four functions at the bottom.

Metadata sits next to the media on purpose. A persona is not a secret, it is
served to the kiosk anyway, and keeping one avatar in one place is worth more than
the tidiness of splitting it.
"""

import json
import re
import shutil
from dataclasses import asdict, dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
AVATARS_DIR = ROOT / "frontend" / "public" / "avatars"

#: Which cabinet shows whom. In `knowledge/` because that is the folder a
#: deployment keeps.
#:
#: It used to sit at the repo root, which is on no volume: `catalog.db`,
#: `.secret`, `seasons.json` and the event log are all under `knowledge/`, and
#: every avatar is under `frontend/public/avatars/`, so those two are what
#: `deploy/compose.yml` mounts. A kiosks file outside both meant every
#: registered cabinet vanished on the next `docker compose up --build` — and it
#: would have looked like a bug in kiosk registration rather than a missing
#: mount, because the products and the avatars all came back.
KIOSKS_FILE = ROOT / "knowledge" / "kiosks.json"
#: Where it used to live. Read when the new path does not exist yet, so an
#: install that already has cabinets keeps them; the next write moves it.
LEGACY_KIOSKS_FILE = ROOT / "kiosks.json"

POSES = ("idle", "listen", "think", "speak")

DEFAULT_PERSONA = (ROOT / "backend" / "persona.md").read_text(encoding="utf-8")

#: Avatars that existed before tenancy belong here, so an upgrade does not make
#: a working kiosk's avatar invisible to the studio that manages it.
DEFAULT_ORG = "default"


@dataclass
class Avatar:
    id: str
    name: str
    persona: str
    greeting: str
    language: str = "en-US"
    #: "male", "female", or blank when it does not matter. Decides which browser
    #: voice speaks for this avatar — without it the picker takes the first name
    #: on a fixed list, which is how a man ended up speaking in a woman's voice.
    gender: str = ""
    voice: str = ""              # an exact voice name, overriding gender entirely
    renderer: str = "mp4"        # mp4 | simli | heygen | anam
    provider_avatar_id: str = "" # set once a lip-sync provider has cloned them
    org_id: str = DEFAULT_ORG
    poster: str = ""
    clips: dict[str, str] = field(default_factory=dict)

    @property
    def ready(self) -> bool:
        """A visitor can be shown this avatar."""
        return bool(self.poster)

    @property
    def missing_clips(self) -> list[str]:
        return [pose for pose in POSES if pose not in self.clips]


@dataclass
class Kiosk:
    id: str
    avatar_id: str
    label: str = ""
    org_id: str = DEFAULT_ORG


def _read_avatar(folder: Path) -> Avatar:
    meta = {}
    meta_file = folder / "avatar.json"
    if meta_file.exists():
        meta = json.loads(meta_file.read_text(encoding="utf-8"))

    url = f"/avatars/{folder.name}"

    poster = ""
    for name in ("poster.png", "poster.jpg", "poster.svg"):
        if (folder / name).exists():
            poster = f"{url}/{name}"
            break

    clips = {p: f"{url}/{p}.mp4" for p in POSES if (folder / f"{p}.mp4").exists()}

    return Avatar(
        id=folder.name,
        name=meta.get("name") or folder.name.title(),
        persona=meta.get("persona") or DEFAULT_PERSONA,
        greeting=meta.get("greeting") or "Welcome.\nHow may I help you today?",
        language=meta.get("language", "en-US"),
        gender=meta.get("gender", ""),
        voice=meta.get("voice", ""),
        renderer=meta.get("renderer", "mp4"),
        provider_avatar_id=meta.get("provider_avatar_id", ""),
        org_id=meta.get("org_id", DEFAULT_ORG),
        poster=poster,
        clips=clips,
    )


def list_avatars(org_id: str | None = None) -> list[Avatar]:
    """Every avatar, or one org's. `None` means "no tenant filter" and is for the
    kiosk path, which resolves an avatar by id before it knows any org."""
    if not AVATARS_DIR.is_dir():
        return []
    found = (_read_avatar(d) for d in AVATARS_DIR.iterdir() if d.is_dir())
    if org_id is not None:
        found = (a for a in found if a.org_id == org_id)
    return sorted(found, key=lambda a: a.id)


def get_avatar(avatar_id: str, org_id: str | None = None) -> Avatar | None:
    folder = AVATARS_DIR / avatar_id
    # A traversal here would read any folder on disk under the guise of an
    # avatar id, and the id arrives straight off a URL.
    if not _safe_id(avatar_id) or not folder.is_dir():
        return None
    avatar = _read_avatar(folder)
    if org_id is not None and avatar.org_id != org_id:
        return None
    return avatar


def _safe_id(value: str) -> bool:
    """Avatar and kiosk ids become path segments and filenames."""
    return bool(re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,63}", value or ""))


def new_id(name: str) -> str:
    """A folder name from a display name, unique against what already exists."""
    base = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")[:40] or "avatar"
    candidate, n = base, 2
    while (AVATARS_DIR / candidate).exists():
        candidate, n = f"{base}-{n}", n + 1
    return candidate


def create_avatar(name: str, org_id: str = DEFAULT_ORG, **fields) -> Avatar:
    """An empty avatar with a folder of its own. Media arrives afterwards, from
    the studio upload or the asset pipeline — both write into this folder."""
    avatar = Avatar(
        id=new_id(name),
        name=name.strip() or "Untitled",
        persona=fields.get("persona") or DEFAULT_PERSONA,
        greeting=fields.get("greeting") or "Welcome.\nHow may I help you today?",
        language=fields.get("language", "en-US"),
        gender=fields.get("gender", ""),
        voice=fields.get("voice", ""),
        renderer=fields.get("renderer", "mp4"),
        org_id=org_id,
    )
    (AVATARS_DIR / avatar.id).mkdir(parents=True, exist_ok=True)
    return save_avatar(avatar)


def delete_avatar(avatar_id: str, org_id: str | None = None) -> bool:
    """Removes the folder and everything in it — poster, clips, campaigns."""
    avatar = get_avatar(avatar_id, org_id)
    if avatar is None:
        return False
    shutil.rmtree(AVATARS_DIR / avatar_id, ignore_errors=True)
    kiosks = list_kiosks()
    # A kiosk pointing at a deleted avatar would fall through to the default and
    # show a stranger. Unassign instead, so it reads as "unregistered".
    for kiosk_id, entry in list(kiosks.items()):
        if entry.get("avatar_id") == avatar_id:
            kiosks.pop(kiosk_id)
    _write_kiosks(kiosks)
    return True


def save_avatar(avatar: Avatar) -> Avatar:
    """Write the editable fields. Media is owned by the asset pipeline, not here."""
    folder = AVATARS_DIR / avatar.id
    folder.mkdir(parents=True, exist_ok=True)
    editable = {
        k: v
        for k, v in asdict(avatar).items()
        if k not in ("id", "poster", "clips")
    }
    (folder / "avatar.json").write_text(
        json.dumps(editable, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    return _read_avatar(folder)


def avatar_dir(avatar_id: str) -> Path:
    """Where an avatar's media lives. Callers writing files go through this so the
    id is validated in one place rather than at every upload."""
    if not _safe_id(avatar_id):
        raise ValueError(f"unusable avatar id: {avatar_id!r}")
    return AVATARS_DIR / avatar_id


def default_avatar(org_id: str | None = None) -> Avatar | None:
    """What a kiosk shows when nothing has been assigned to it."""
    avatars = list_avatars(org_id)
    ready = [a for a in avatars if a.ready]
    return (ready or avatars or [None])[0]


def list_kiosks(org_id: str | None = None) -> dict[str, dict]:
    # New path first, old one only while the new one is absent. An install that
    # already has cabinets keeps them, and the next write puts the file where it
    # will survive a redeploy.
    source = KIOSKS_FILE if KIOSKS_FILE.exists() else LEGACY_KIOSKS_FILE
    if not source.exists():
        return {}
    try:
        kiosks = json.loads(source.read_text(encoding="utf-8"))
    except ValueError:
        return {}
    if org_id is None:
        return kiosks
    return {k: v for k, v in kiosks.items() if v.get("org_id", DEFAULT_ORG) == org_id}


def _write_kiosks(kiosks: dict[str, dict]) -> None:
    KIOSKS_FILE.parent.mkdir(parents=True, exist_ok=True)
    KIOSKS_FILE.write_text(
        json.dumps(kiosks, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )


def save_kiosk(kiosk: Kiosk) -> Kiosk:
    if not _safe_id(kiosk.id):
        raise ValueError(f"unusable kiosk id: {kiosk.id!r}")
    kiosks = list_kiosks()
    kiosks[kiosk.id] = {
        "avatar_id": kiosk.avatar_id,
        "label": kiosk.label,
        "org_id": kiosk.org_id,
    }
    _write_kiosks(kiosks)
    return kiosk


def delete_kiosk(kiosk_id: str, org_id: str | None = None) -> bool:
    kiosks = list_kiosks()
    entry = kiosks.get(kiosk_id)
    if entry is None or (org_id is not None and entry.get("org_id", DEFAULT_ORG) != org_id):
        return False
    kiosks.pop(kiosk_id)
    _write_kiosks(kiosks)
    return True


def get_kiosk(kiosk_id: str) -> Kiosk:
    """Unregistered kiosks fall back to the default avatar rather than erroring —
    a showroom screen showing nothing is worse than one showing the wrong person."""
    entry = list_kiosks().get(kiosk_id)
    if entry:
        return Kiosk(
            id=kiosk_id,
            avatar_id=entry["avatar_id"],
            label=entry.get("label", ""),
            org_id=entry.get("org_id", DEFAULT_ORG),
        )

    fallback = default_avatar()
    return Kiosk(
        id=kiosk_id,
        avatar_id=fallback.id if fallback else "",
        label="unregistered",
        org_id=fallback.org_id if fallback else DEFAULT_ORG,
    )
