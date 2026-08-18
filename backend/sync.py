"""Pull avatar configuration down from the platform.

Runs on the edge. Writes into the same folders `store.py` already reads, so there
is no cache layer and no second code path — **the local files are the cache**. A
kiosk that cannot reach the cloud simply keeps serving whatever it last received,
which is exactly what a showroom needs when the Wi-Fi drops mid-morning.

Media is never synced. Clips are tens of megabytes and egress out of an Indian
region is billed at six times the US rate; footage belongs on the kiosk's own disk,
put there by the asset pipeline.

**A cabinet pulls its own configuration and nothing else.** It used to fetch every
avatar on the platform, which was harmless with one customer and became a
cross-tenant leak the moment there were two — one company's persona written to
another company's disk. `GET /api/kiosk/{id}` is public precisely because it is
scoped: a cabinet asks who *it* is, keyed by an id it already has.
"""

import json
import threading
import urllib.error
import urllib.parse
import urllib.request

from backend import config
from backend.store import AVATARS_DIR, KIOSKS_FILE

TIMEOUT = 10

#: Written by sync, read by store.py. Only ever holds this cabinet's own row.
SYNCED_KEYS = (
    "name", "persona", "greeting", "language",
    "voice", "renderer", "provider_avatar_id", "org_id",
)


def _fetch(path: str):
    request = urllib.request.Request(
        f"{config.PLATFORM_URL.rstrip('/')}{path}",
        headers={"Accept": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        return json.loads(response.read())


def pull() -> str:
    """Fetch and write. Returns a one-line status for the log."""
    if not config.PLATFORM_URL:
        return "sync: no PLATFORM_URL, running standalone"

    try:
        payload = _fetch(f"/api/kiosk/{urllib.parse.quote(config.KIOSK_ID)}")
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        # Never fatal. The kiosk has last-known-good config on disk.
        return f"sync: platform unreachable ({error}); using local config"

    avatar = payload.get("avatar") or {}
    if not avatar.get("id"):
        return "sync: platform has no avatar for this cabinet; using local config"

    folder = AVATARS_DIR / avatar["id"]
    folder.mkdir(parents=True, exist_ok=True)
    meta = {key: avatar.get(key, "") for key in SYNCED_KEYS}
    target = folder / "avatar.json"
    body = json.dumps(meta, indent=2, ensure_ascii=False) + "\n"

    # Only write on change, so a kiosk polling every few minutes does not rewrite
    # the same bytes forever.
    changed = not target.exists() or target.read_text(encoding="utf-8") != body
    if changed:
        target.write_text(body, encoding="utf-8")

    kiosk = payload.get("kiosk") or {}
    if kiosk.get("avatar_id"):
        KIOSKS_FILE.write_text(
            json.dumps(
                {
                    config.KIOSK_ID: {
                        "avatar_id": kiosk["avatar_id"],
                        "label": kiosk.get("label", ""),
                        "org_id": kiosk.get("org_id", "default"),
                    }
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )

    return f"sync: {avatar['id']}{' updated' if changed else ' unchanged'}"


def start() -> None:
    """Sync now, then on an interval, always off the request path."""
    if not config.PLATFORM_URL:
        return

    def loop() -> None:
        while True:
            print(pull())
            threading.Event().wait(config.SYNC_INTERVAL)

    threading.Thread(target=loop, daemon=True).start()
