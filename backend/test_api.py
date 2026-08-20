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

from backend import accounts, catalog, documents, store  # noqa: E402

catalog.DB_PATH = TMP / "test.db"
documents.DB_PATH = catalog.DB_PATH
store.AVATARS_DIR = TMP / "avatars"
store.KIOSKS_FILE = TMP / "kiosks.json"
store.AVATARS_DIR.mkdir(parents=True)

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

print("\nthe cabinet boots")
r = client.get("/api/kiosk/mumbai-1")
check("it gets its avatar without a token", r.json()["avatar"]["id"] == AVATAR)
check("and its greeting", r.json()["avatar"]["greeting"] == "Welcome.")
check("and whether it may offer a camera", r.json()["tryon"]["available"] is False)

r = client.get(f"/api/products?q=laptop for video editing&avatar={AVATAR}")
names = [p["name"] for p in r.json()]
# Both are laptops, so both match; what matters is that the one whose
# description says "video editing" is ranked first.
check("it searches the catalog", names[:1] == ["Titan Pro 16"], str(names))
check("and both laptops come back", len(names) == 2, str(names))

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

