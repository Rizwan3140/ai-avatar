"""Advertising for the hours nobody is talking.

A showroom kiosk is idle most of its life. Right now that time shows a man
standing still, which is a waste of the most expensive screen in the room.

Campaigns are files in `frontend/public/campaigns/<org>/` plus one
`campaigns.json` describing when each runs. Same shape as everything else here:
readable from disk, editable by hand, synced from the platform, and working with
the network unplugged.

**Per showroom, not per avatar.** They used to live under
`avatars/<id>/campaigns/`, which made the advertising a property of whichever
person happened to be standing in the cabinet — so uploading a campaign against
one avatar and then demonstrating with another showed nothing at all, and a
shop running two avatars had to upload everything twice and keep the two in
step by hand. A campaign belongs to the company whose window it is playing in.

Still scoped by org, because that is the tenant boundary everything else here
uses. One showroom's advertising must not appear in another's window.
"""

import json
import re
from dataclasses import asdict, dataclass
from dataclasses import fields as dataclass_fields
from datetime import time
from pathlib import Path

from backend import config
from backend.store import _safe_id, get_avatar

MEDIA = {".mp4": "video", ".webm": "video", ".jpg": "image", ".jpeg": "image",
         ".png": "image", ".webp": "image"}


@dataclass
class Campaign:
    id: str
    src: str
    kind: str = "image"
    #: Spoken when the campaign is on screen and someone walks up.
    invitation: str = ""
    #: 24h window, inclusive of start and exclusive of end. "" means always.
    starts: str = ""
    ends: str = ""
    seconds: int = 8

    def runs_at(self, now: time) -> bool:
        """Whether this campaign should be playing at a given time of day."""
        if not self.starts or not self.ends:
            return True
        try:
            start = time.fromisoformat(self.starts)
            end = time.fromisoformat(self.ends)
        except ValueError:
            return True
        # A window like 21:00-06:00 crosses midnight and would otherwise never
        # match — evening promotions are exactly the case that needs it.
        if start <= end:
            return start <= now < end
        return now >= start or now < end


#: Where a showroom's advertising lives. Beside `avatars/`, not inside it.
ROOT = config.DATA / "frontend" / "public" / "campaigns"


def _folder(org_id: str) -> Path | None:
    """None for an id that could never be a folder.

    The org id reaches here from a resolved avatar rather than off a URL, but it
    still becomes a path segment — and every other join in this codebase that
    skipped the shared validator turned out to be the one worth auditing.
    """
    return ROOT / org_id if _safe_id(org_id) else None


def org_of(avatar_id: str) -> str:
    """Whose window this avatar is standing in.

    The kiosk still asks by avatar, because that is the only id it has. The
    answer is the same for every avatar in the same showroom.
    """
    avatar = get_avatar(avatar_id)
    return avatar.org_id if avatar else ""


def declared(org_id: str) -> list[Campaign]:
    """Every campaign configured for this showroom, whatever the clock says.

    Falls back to whatever media is in the folder if nothing is scheduled — a
    company that drops in three images should see them play without first writing
    a schedule file.
    """
    folder = _folder(org_id)
    if folder is None or not folder.is_dir():
        return []

    manifest = folder / "campaigns.json"
    if manifest.exists():
        try:
            entries = json.loads(manifest.read_text(encoding="utf-8"))
        except ValueError:
            return []
        # Unknown keys are ignored rather than raising. This file is written by
        # sync from a platform that may be a version ahead, and `Campaign(**e)`
        # on an unexpected field is a TypeError — a 500 on the one endpoint a
        # cabinet calls to know what to advertise.
        fields = {f.name for f in dataclass_fields(Campaign)}
        return [Campaign(**{k: v for k, v in e.items() if k in fields}) for e in entries]

    return [
        Campaign(id=path.stem, src=f"/campaigns/{org_id}/{path.name}", kind=kind)
        for path in sorted(folder.iterdir())
        if (kind := MEDIA.get(path.suffix.lower()))
    ]


def for_avatar(avatar_id: str, now: time | None = None) -> list[Campaign]:
    """Campaigns due to play right now, in order. What a kiosk asks for.

    Takes an avatar because that is the only id a cabinet has, and answers with
    the showroom's advertising — which is the same whoever is standing in the
    window.
    """
    return for_org(org_of(avatar_id), now)


def for_org(org_id: str, now: time | None = None) -> list[Campaign]:
    from datetime import datetime

    if not org_id:
        return []
    moment = now or datetime.now().time()
    return [c for c in declared(org_id) if c.runs_at(moment)]


def save(org_id: str, items: list[Campaign]) -> list[Campaign]:
    """Write the schedule.

    Writing the file at all is what switches this showroom from "play everything
    in the folder" to "play what is declared" — so saving an empty list is a
    valid instruction meaning *stop advertising*, not a no-op.
    """
    folder = _folder(org_id)
    if folder is None:
        raise ValueError(f"unusable org id: {org_id!r}")
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "campaigns.json").write_text(
        json.dumps([asdict(c) for c in items], indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return items


def save_media(org_id: str, filename: str, data: bytes) -> str:
    """Store an uploaded image or clip and return the URL a kiosk plays it from.

    The extension is checked against what a browser will actually render, because
    the failure otherwise is a silent black rectangle in a showroom window rather
    than an error anyone sees.
    """
    safe = re.sub(r"[^A-Za-z0-9._-]+", "-", Path(filename).name).strip("-.")
    suffix = Path(safe).suffix.lower()
    if suffix not in MEDIA:
        raise ValueError(f"{suffix or 'that file'} will not play — use {', '.join(sorted(MEDIA))}")

    folder = _folder(org_id)
    if folder is None:
        raise ValueError(f"unusable org id: {org_id!r}")
    folder.mkdir(parents=True, exist_ok=True)
    (folder / safe).write_bytes(data)
    return f"/campaigns/{org_id}/{safe}"


def to_dict(campaign: Campaign) -> dict:
    return asdict(campaign)
