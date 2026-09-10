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
from backend.store import KIOSKS_FILE, avatar_dir

TIMEOUT = 10

#: Written by sync, read by store.py. Only ever holds this cabinet's own row.
SYNCED_KEYS = (
    "name", "persona", "greeting", "language",
    "gender", "voice", "renderer", "provider_avatar_id", "org_id",
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

    # Through `avatar_dir`, which validates. This used to join the id straight
    # onto the avatars folder, and the id arrives in a JSON body from another
    # machine — so a compromised platform, or anyone on-path while PLATFORM_URL
    # is plain http, could answer with `"id": "../../.."` and write a file
    # anywhere the kiosk process can reach. Every other path join in this
    # codebase goes through here; this one had been missed.
    try:
        folder = avatar_dir(avatar["id"])
    except ValueError:
        return f"sync: platform sent an unusable avatar id {avatar['id']!r}; using local config"
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


def pull_catalog() -> str:
    """Mirror this cabinet's catalog from the platform.

    Separate from `pull` and separately failing. Identity and stock are not the
    same urgency: a cabinet that cannot refresh its product list is still a
    working cabinet showing slightly old prices, and it should not lose an
    avatar update over that.

    Deliberately a mirror rather than a merge. The reason this exists is that a
    catalog was pruned from five thousand rows to two hundred and fifty on one
    machine and there was no way to say so to another — and a merge cannot
    express a deletion, so the pruned rows would have come straight back.

    Every failure keeps what is on disk. Unreachable platform, malformed
    payload, empty list: the local catalog is last-known-good and a showroom
    serving yesterday's prices beats one serving nothing.
    """
    if not config.PLATFORM_URL:
        return "catalog: no PLATFORM_URL, running standalone"

    # Imported here, not at module scope. `catalog` opens a database on import
    # and this module is loaded by both roles; the rule in this codebase is that
    # shared code does not pull heavy imports in at the top.
    from backend import catalog

    try:
        payload = _fetch(f"/api/kiosk/{urllib.parse.quote(config.KIOSK_ID)}/catalog")
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        return f"catalog: platform unreachable ({error}); keeping local"

    rows = payload.get("products")
    org_id = payload.get("org_id")
    if not isinstance(rows, list) or not rows or not org_id:
        # Includes the genuinely-empty case. A platform with no products for
        # this cabinet cannot be told apart from a response that lost them, and
        # only one of those two readings is safe to act on.
        return "catalog: platform sent nothing usable; keeping local"

    products = [
        catalog.Product(
            id=r.get("id", ""),
            name=r.get("name", ""),
            category=r.get("category", ""),
            price=r.get("price"),
            currency=r.get("currency", "INR"),
            description=r.get("description", ""),
            url=r.get("url", ""),
            image=r.get("image", ""),
            images=r.get("images") or [],
            video=r.get("video", ""),
            availability=r.get("availability", "in_stock"),
            attributes=r.get("attributes") or {},
        )
        for r in rows
        if r.get("id") and r.get("name")
    ]
    if not products:
        return "catalog: every row was unusable; keeping local"

    before = len(catalog.all_products(org_id))
    catalog.replace(products, org_id)
    if before == len(products):
        return f"catalog: {len(products)} products, unchanged"
    return f"catalog: {before} -> {len(products)} products"


def insecure_platform() -> str:
    """Why this PLATFORM_URL must not be used, or "" when it is fine.

    Everything this module writes is trusted completely: the persona a public
    screen speaks from, and the whole catalog including prices. Over plain http
    that content is whatever the network decides it is, and the kiosk has no way
    to tell. Loopback is exempt because there is no network to sit on.
    """
    parsed = urllib.parse.urlparse(config.PLATFORM_URL)
    if parsed.scheme == "https":
        return ""
    if parsed.hostname in ("127.0.0.1", "::1", "localhost"):
        return ""
    return (
        f"PLATFORM_URL is {config.PLATFORM_URL!r}. Sync trusts the persona and "
        f"the catalog it receives; over plain http those are whatever the "
        f"network says they are. Use https://."
    )


def start() -> None:
    """Sync now, then on an interval, always off the request path."""
    if not config.PLATFORM_URL:
        return

    refusal = insecure_platform()
    if refusal:
        print(f"  sync: refusing to run. {refusal}")
        return

    def loop() -> None:
        while True:
            print(pull())
            # Identity first, then stock. If the platform is only reachable for
            # one of the two, the one worth having is the cabinet knowing who it
            # is — and neither can fail the other, because each returns its own
            # status rather than raising.
            print(pull_catalog())
            threading.Event().wait(config.SYNC_INTERVAL)

    threading.Thread(target=loop, daemon=True).start()
