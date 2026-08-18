"""Advertising for the hours nobody is talking.

A showroom kiosk is idle most of its life. Right now that time shows a man
standing still, which is a waste of the most expensive screen in the room.

Campaigns are files in `frontend/public/avatars/<id>/campaigns/` plus one
`campaigns.json` describing when each runs. Same shape as everything else here:
readable from disk, editable by hand, synced from the platform, and working with
the network unplugged.
"""

import json
import re
from dataclasses import asdict, dataclass
from datetime import time
from pathlib import Path

from backend.store import avatar_dir

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


def _folder(avatar_id: str) -> Path | None:
    """None for an id that could never be a folder. The id arrives off a URL, so
    this is the traversal guard as much as a validation."""
    try:
        return avatar_dir(avatar_id) / "campaigns"
    except ValueError:
        return None


def declared(avatar_id: str) -> list[Campaign]:
    """Every campaign configured for this avatar, whatever the clock says.

    Falls back to whatever media is in the folder if nothing is scheduled — a
    company that drops in three images should see them play without first writing
    a schedule file.
    """
    folder = _folder(avatar_id)
    if folder is None or not folder.is_dir():
        return []

    config = folder / "campaigns.json"
    if config.exists():
        return [Campaign(**entry) for entry in json.loads(config.read_text(encoding="utf-8"))]

    return [
        Campaign(id=path.stem, src=f"/avatars/{avatar_id}/campaigns/{path.name}", kind=kind)
        for path in sorted(folder.iterdir())
        if (kind := MEDIA.get(path.suffix.lower()))
    ]


def for_avatar(avatar_id: str, now: time | None = None) -> list[Campaign]:
    """Campaigns due to play right now, in order. What a kiosk asks for."""
    from datetime import datetime

    moment = now or datetime.now().time()
    return [c for c in declared(avatar_id) if c.runs_at(moment)]


def save(avatar_id: str, items: list[Campaign]) -> list[Campaign]:
    """Write the schedule.

    Writing the file at all is what switches this avatar from "play everything in
    the folder" to "play what is declared" — so saving an empty list is a valid
    instruction meaning *stop advertising*, not a no-op.
    """
    folder = _folder(avatar_id)
    if folder is None:
        raise ValueError(f"unusable avatar id: {avatar_id!r}")
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "campaigns.json").write_text(
        json.dumps([asdict(c) for c in items], indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return items


def save_media(avatar_id: str, filename: str, data: bytes) -> str:
    """Store an uploaded image or clip and return the URL a kiosk plays it from.

    The extension is checked against what a browser will actually render, because
    the failure otherwise is a silent black rectangle in a showroom window rather
    than an error anyone sees.
    """
    safe = re.sub(r"[^A-Za-z0-9._-]+", "-", Path(filename).name).strip("-.")
    suffix = Path(safe).suffix.lower()
    if suffix not in MEDIA:
        raise ValueError(f"{suffix or 'that file'} will not play — use {', '.join(sorted(MEDIA))}")

    folder = _folder(avatar_id)
    if folder is None:
        raise ValueError(f"unusable avatar id: {avatar_id!r}")
    folder.mkdir(parents=True, exist_ok=True)
    (folder / safe).write_bytes(data)
    return f"/avatars/{avatar_id}/campaigns/{safe}"


def to_dict(campaign: Campaign) -> dict:
    return asdict(campaign)
