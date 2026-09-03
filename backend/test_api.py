"""End-to-end through the real ASGI app.

    ./.venv/bin/python -m backend.test_api

`test_platform.py` checks the modules; this checks that the routes are wired to
them — the auth dependency actually applied, the org actually taken from the
token rather than the query string, the 401 actually returned. A module can be
perfectly tenant-safe behind a route that forgot to ask who was calling.

Walks the path a customer walks: no accounts -> create one -> the machine closes
-> import a catalog and a policy -> register a cabinet -> the cabinet boots and
asks a question. Then a second org tries to read and write the first one's
things, and is refused at every door.

Needs `httpx`, which arrives with FastAPI's TestClient. Runs against a throwaway
directory: an earlier version of this file bound the database path at import and
wrote its test accounts into the real catalog, which is the reason `accounts.py`
now reads `catalog.DB_PATH` on every call.
"""

import io
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

TMP = Path(tempfile.mkdtemp(prefix="luxora-test-api-"))

os.environ["LUXORA_ROLE"] = "cloud"  # no model, no whisper, no microphone
os.environ["LUXORA_SECRET"] = "test-only-secret"
# This suite builds its own catalog and asserts exact counts. Importing the app
# would otherwise seed twelve sample products into the fixture and every count
# below would be wrong — a side effect at import time is exactly the kind that
# hides until something depends on it.
os.environ["LUXORA_SEED"] = "0"

from backend import accounts, catalog, documents, store, tryon  # noqa: E402

# Pin the try-on providers to the one that refuses, for the same reason the
# database is redirected two lines below: this suite asserts what the routes do,
# and it must not depend on which keys happen to be in the developer's .env.
#
# It did. With a real FAL_KEY present, `POST /api/tryon` stopped returning "no
# provider" and instead made a live, billable call to fal.ai from the test
# suite — which is how this was found. A test run must never reach a paid third
# party, whatever is configured on the machine running it.
tryon._PROVIDERS = {"local": tryon.LocalProvider()}

catalog.DB_PATH = TMP / "test.db"
documents.DB_PATH = catalog.DB_PATH
store.AVATARS_DIR = TMP / "avatars"
store.KIOSKS_FILE = TMP / "kiosks.json"
# Both paths, or the legacy fallback reads the developer's real one.
store.LEGACY_KIOSKS_FILE = TMP / "legacy-root-kiosks.json"
store.AVATARS_DIR.mkdir(parents=True)

import av  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from backend.main import app  # noqa: E402

client = TestClient(app)
ok = bad = 0


def check(label, condition, extra=""):
    global ok, bad
    if condition:
        ok += 1
        print(f"  ok    {label}")
    else:
        bad += 1
        print(f"  FAIL  {label} {extra}")


print("\nbootstrap")
r = client.get("/api/auth/status")
check("a fresh machine reports itself open", r.json() == {"open": True})

r = client.get("/api/studio/avatars")
check("and the studio answers without a token", r.status_code == 200)

r = client.post(
    "/api/auth/signup",
    json={"email": "ops@northwind.com", "password": "a-long-enough-one", "org_name": "Northwind"},
)
check("first signup succeeds", r.status_code == 200, r.text[:120])
NORTH = r.json()["org_id"]
north = {"Authorization": f"Bearer {r.json()['token']}"}

check("the machine is now closed", client.get("/api/auth/status").json() == {"open": False})
check("and the studio refuses an anonymous caller", client.get("/api/studio/avatars").status_code == 401)
check("but accepts the token", client.get("/api/studio/avatars", headers=north).status_code == 200)
check(
    "a second signup is refused",
    client.post("/api/auth/signup", json={"email": "x@y.com", "password": "a-long-enough-one"}).status_code
    == 403,
)

print("\nbuilding a showroom")
r = client.post("/api/studio/avatars", headers=north, json={"name": "Krish", "greeting": "Welcome."})
check("an avatar is created", r.status_code == 200, r.text[:160])
AVATAR = r.json()["id"]
check("it reports no poster yet", r.json()["ready"] is False)
check("and four missing clips", len(r.json()["missing_clips"]) == 4)

r = client.patch(
    f"/api/studio/avatars/{AVATAR}", headers=north, json={"persona": "You sell laptops in Pune."}
)
check("the persona saves", r.json()["persona"] == "You sell laptops in Pune.")

csv = b"name,category,price,description,image\nTitan Pro 16,laptop,189900,For video editing,https://x/t.jpg\nAria 14,laptop,129900,Light and quiet,\n"
r = client.post("/api/studio/import?filename=catalog.csv", headers=north, content=csv)
check("a csv imports as products", r.json() == {"source": "catalog.csv", "products": 2, "passages": 0}, r.text[:160])

policy = b"Returns Policy\n\nAny item may be returned within thirty days of purchase.\n\nDelivery\n\nWe deliver across Maharashtra.\n"
r = client.post("/api/studio/import?filename=policy.txt", headers=north, content=policy)
check("a policy imports as passages", r.json()["passages"] >= 1, r.text[:160])
check("and as no products", r.json()["products"] == 0)

r = client.put(
    "/api/studio/kiosks/mumbai-1",
    headers=north,
    json={"id": "mumbai-1", "avatar_id": AVATAR, "label": "Ground floor"},
)
check("a cabinet registers", r.status_code == 200, r.text[:160])

# Where it registers *to* is the deploy-critical part. `kiosks.json` used to sit
# at the repo root, which no volume mounts, so every cabinet disappeared on the
# next `docker compose up --build` — and it read as broken registration rather
# than a missing mount, because the products and avatars all came back.
check("it is written where a deployment keeps state", store.KIOSKS_FILE.exists())
check("and not at the old root path", not store.LEGACY_KIOSKS_FILE.exists())

# An install that already has cabinets must not be orphaned by the move.
_legacy = TMP / "legacy-kiosks.json"
_legacy.write_text(
    json.dumps({"old-1": {"avatar_id": AVATAR, "label": "Before", "org_id": NORTH}}),
    encoding="utf-8",
)
_new, store.KIOSKS_FILE = store.KIOSKS_FILE, TMP / "absent.json"
_old, store.LEGACY_KIOSKS_FILE = store.LEGACY_KIOSKS_FILE, _legacy
check("an existing install's cabinets still load", "old-1" in store.list_kiosks())
store.KIOSKS_FILE, store.LEGACY_KIOSKS_FILE = _new, _old

print("\nthe cabinet boots")
r = client.get("/api/kiosk/mumbai-1")
check("it gets its avatar without a token", r.json()["avatar"]["id"] == AVATAR)
check("and its greeting", r.json()["avatar"]["greeting"] == "Welcome.")
check("and whether it may offer a camera", r.json()["tryon"]["available"] is False)

# `/` is the panel, and it must stay the panel. A fresh install with no avatars
# sends the first person to the Studio instead of to a blank screen reading "the
# showroom is offline" — but the moment one avatar exists that redirect has to
# stop, or a cabinet in a mall bounces away from its own face on every reload.
if (Path(__file__).resolve().parent.parent / "frontend" / "dist").is_dir():
    check(
        "a cabinet with an avatar is served the kiosk, not the studio",
        client.get("/", follow_redirects=False).status_code == 200,
    )
    _real = store.AVATARS_DIR
    store.AVATARS_DIR = TMP / "nobody"
    store.AVATARS_DIR.mkdir(exist_ok=True)
    empty = client.get("/", follow_redirects=False)
    store.AVATARS_DIR = _real
    check("with no avatars at all it redirects", empty.status_code == 307)
    check("and it redirects to the studio", empty.headers.get("location") == "/studio")

print(chr(10) + "voice")
# A voice is a property of an avatar, cloned from a recording the customer
# supplies. Until one exists the browser's own synthesiser speaks, and the
# cabinet must be told that honestly rather than trying a voice that is absent.
r = client.get(f"/api/voice?avatar={AVATAR}")
check("a cabinet can ask whose voice it has", r.status_code == 200, r.text[:120])
check("and is told there is none yet", r.json()["available"] is False)
check("with the reason named", r.json()["has_reference"] is False)

r = client.post("/api/speak", json={"text": "hello", "avatar_id": AVATAR})
check("speaking without a recording is refused, not silent", r.status_code == 503, r.text[:160])
check("and says what is missing", "no voice recording" in r.json()["detail"], r.text[:200])

# The recording is read back by a model that will not explain itself if handed
# something that is not audio, so the route decodes the upload rather than
# sniffing four bytes. A header-shaped file with no audio in it used to pass.
r = client.post(f"/api/studio/avatars/{AVATAR}/voice", headers=north, content=b"not audio at all")
check("a file that is not audio is refused", r.status_code == 400, r.text[:120])

header_only = b"RIFF" + (36).to_bytes(4, "little") + b"WAVEfmt " + bytes(36)
r = client.post(f"/api/studio/avatars/{AVATAR}/voice", headers=north, content=header_only)
check("a WAV header with no audio is refused", r.status_code == 400, r.text[:120])

# A real recording, encoded here. MP3 because that is what a customer has —
# a phone recording, a voice note — and requiring a conversion first is how a
# feature goes unused.
buffer = io.BytesIO()
with av.open(buffer, "w", format="mp3") as out:
    stream = out.add_stream("mp3", rate=44100)
    frame = av.AudioFrame(format="s16", layout="mono", samples=44100)
    frame.rate = 44100
    frame.planes[0].update(bytes([0, 1]) * 44100)
    for packet in stream.encode(frame):
        out.mux(packet)
    for packet in stream.encode(None):
        out.mux(packet)

r = client.post(f"/api/studio/avatars/{AVATAR}/voice", headers=north, content=buffer.getvalue())
check("an MP3 is accepted", r.status_code == 200, r.text[:160])
check("and is stored as about a second of audio", 0.8 < r.json()["seconds"] < 1.3, r.text[:160])
check("and the avatar now has a voice", client.get(f"/api/voice?avatar={AVATAR}").json()["has_reference"])

r = client.delete(f"/api/studio/avatars/{AVATAR}/voice", headers=north)
check("removing the recording removes the voice", r.status_code == 200)
check("back to the browser", client.get(f"/api/voice?avatar={AVATAR}").json()["has_reference"] is False)

print("\nseasons")
r = client.put(
    "/api/studio/seasons/diwali",
    headers=north,
    json={
        "id": "diwali", "name": "Diwali",
        "starts": "2026-11-06", "ends": "2026-11-12",
        "tokens": {
            "--color-accent": "#c2410c",
            "--color-canvas": "#000000",                 # not themeable
            "--color-line": "not-a-colour",              # will not parse
            "--font-display": "x; } html { display:none",  # injection attempt
        },
    },
)
check("a season saves", r.status_code == 200, r.text[:160])
check(
    "and keeps only what may be themed, and only if it parses",
    r.json()["tokens"] == {"--color-accent": "#c2410c"},
    r.text[:200],
)
# A season repaints a screen the public looks at. Whose screen is not the
# caller's to name.
check("the org comes from the token", r.json()["org_id"] == NORTH)
check(
    "the cabinet is told what to wear",
    "season" in client.get("/api/kiosk/mumbai-1").json(),
)
r = client.get(f"/api/products?q=laptop for video editing&avatar={AVATAR}")
names = [p["name"] for p in r.json()]
# Both are laptops, so both match — and only the best-ranked one comes back,
# because a plain query is a browse and browses show one per category. What
# matters is that the one whose description says "video editing" is the one kept.
check("it searches the catalog", names[:1] == ["Titan Pro 16"], str(names))
check("and thins same-category matches to the best one", len(names) == 1, str(names))

r = client.get(f"/api/products/titan-pro-16?avatar={AVATAR}")
check("and opens one", r.json()["spoken_price"] == "\u20b9189,900")

r = client.post(f"/api/analytics/viewed/titan-pro-16?avatar={AVATAR}")
check("viewing is recorded", r.json() == {"ok": True})

print("\na second company")
r = client.post("/api/studio/members", headers=north, json={"email": "z@z.com", "password": "a-long-enough-one"})
check("an owner can add a member", r.status_code == 200, r.text[:160])

SOUTH = accounts.create_org("Contoso")
rival = accounts.add_member(SOUTH, "rival@contoso.com", "another-long-one", "owner")
south = {"Authorization": f"Bearer {accounts.issue_token(rival)}"}

check("the rival sees no avatars", client.get("/api/studio/avatars", headers=south).json() == [])
check("no cabinets", client.get("/api/studio/kiosks", headers=south).json() == [])
check("no products", client.get("/api/studio/products", headers=south).json() == [])
check("no documents", client.get("/api/studio/knowledge", headers=south).json() == [])
check(
    "cannot edit the other org's avatar",
    client.patch(f"/api/studio/avatars/{AVATAR}", headers=south, json={"name": "Stolen"}).status_code == 404,
)
check(
    "cannot delete it",
    client.delete(f"/api/studio/avatars/{AVATAR}", headers=south).status_code == 404,
)
check(
    "cannot read its campaigns",
    client.get(f"/api/studio/campaigns/{AVATAR}", headers=south).status_code == 404,
)
check(
    "cannot claim its cabinet id",
    client.put(
        "/api/studio/kiosks/mumbai-1", headers=south, json={"id": "mumbai-1", "avatar_id": AVATAR, "label": "x"}
    ).status_code
    in (404, 409),
)
check(
    "cannot delete its cabinet",
    client.delete("/api/studio/kiosks/mumbai-1", headers=south).status_code == 404,
)
check(
    "cannot delete its products",
    client.delete("/api/studio/products/titan-pro-16", headers=south).status_code == 404,
)
check(
    "and the avatar is still there",
    client.get("/api/studio/avatars", headers=north).json()[0]["name"] == "Krish",
)

print("\nroles")
viewer = accounts.add_member(NORTH, "viewer@northwind.com", "another-long-one", "viewer")
eyes = {"Authorization": f"Bearer {accounts.issue_token(viewer)}"}
check("a viewer can read", client.get("/api/studio/avatars", headers=eyes).status_code == 200)
check(
    "a viewer cannot dress the showroom",
    client.put(
        "/api/studio/seasons/spring", headers=eyes, json={"id": "spring", "name": "Spring"}
    ).status_code == 403,
)
check(
    "a viewer cannot write",
    client.patch(f"/api/studio/avatars/{AVATAR}", headers=eyes, json={"name": "No"}).status_code == 403,
)
check(
    "a viewer cannot add people",
    client.post("/api/studio/members", headers=eyes, json={"email": "a@b.com", "password": "a-long-enough-one"}).status_code
    == 403,
)
editor = accounts.add_member(NORTH, "editor@northwind.com", "another-long-one", "editor")
hands = {"Authorization": f"Bearer {accounts.issue_token(editor)}"}
check(
    "an editor can write",
    client.patch(f"/api/studio/avatars/{AVATAR}", headers=hands, json={"name": "Krish"}).status_code == 200,
)
check(
    "but cannot delete an avatar",
    client.delete(f"/api/studio/avatars/{AVATAR}", headers=hands).status_code == 403,
)

print("\ntry-on")
check(
    "without consent the request is refused",
    client.post(f"/api/tryon/titan-pro-16?avatar={AVATAR}", content=b"fake").status_code == 428,
)
r = client.post(f"/api/tryon/titan-pro-16?consent=1&avatar={AVATAR}", content=b"fake")
check("with consent and no provider it says so", r.status_code == 503, r.text[:160])
check("and names what is missing", "local try-on" in r.json()["detail"], r.text[:200])
check(
    "an unknown product 404s before any photo is touched",
    client.post(f"/api/tryon/nope?consent=1&avatar={AVATAR}", content=b"fake").status_code == 404,
)

# A cabinet whose identity call failed sends no avatar at all. It used to fall
# through to whichever avatar sorts first on the box, which with two customers
# is the other company's catalog — read out loud by the avatar.
print("\nan unidentified cabinet")
check(
    "an unknown avatar id does not resolve to some other org's catalog",
    client.get("/api/products?q=laptop&avatar=no-such-avatar").status_code == 404,
)
check(
    "nor does opening a product by id",
    client.get("/api/products/titan-pro-16?avatar=no-such-avatar").status_code == 404,
)
check(
    "nor does try-on",
    client.post(
        "/api/tryon/titan-pro-16?consent=1&avatar=no-such-avatar", content=b"fake"
    ).status_code
    == 404,
)

print("\ninsights")
r = client.get("/api/analytics", headers=north)
check("analytics needs a token", client.get("/api/analytics").status_code == 401)
check("and is scoped to the org", r.status_code == 200, r.text[:160])

r = client.get("/api/studio/summary", headers=north)
s = r.json()
check("summary counts this org's things", (s["avatars"], s["kiosks"], s["products"]) == (1, 1, 2), json.dumps(s))
check("and lists its documents", s["documents"][0]["source"] == "policy.txt")

r = client.get("/api/studio/export", headers=north)
check("an owner can export everything", len(r.json()["products"]) == 2)
check("an editor cannot", client.get("/api/studio/export", headers=hands).status_code == 403)

print(f"\n{ok} passed, {bad} failed")
shutil.rmtree(TMP, ignore_errors=True)
sys.exit(1 if bad else 0)

