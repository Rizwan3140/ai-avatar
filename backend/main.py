"""Composition root. The role decides what this process is.

    LUXORA_ROLE=edge     the machine driving a panel — conversation, models,
                         footage, kiosk UI. Survives the network going down.
    LUXORA_ROLE=cloud    the platform — avatars, kiosks, studio. No models,
                         no GPU, no footage.
    LUXORA_ROLE=all      both, in one process. Development and single-kiosk
                         installs. The default, so nothing changes by accident.

The split exists for one reason: everything in the conversation path needs a model
resident in memory. Deploying that to a cloud container means renting a GPU that
idles through a showroom's quiet hours — more expensive than the entire rest of
the platform. So the models stay where the panel is.

Imports are role-conditional on purpose. `faster-whisper` and its dependencies
must never be pulled into the cloud image.
"""

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from backend import config, store
from backend.routes import platform, studio

ROOT = Path(__file__).resolve().parent.parent
FRONTEND_DIST = ROOT / "frontend" / "dist"

IS_EDGE = config.ROLE in ("edge", "all")
IS_CLOUD = config.ROLE in ("cloud", "all")

app = FastAPI(title=f"Luxora ({config.ROLE})")

# Off unless asked for. The kiosk serves its own UI from this same origin, so
# there is no cross-origin request to permit and a permissive default would be
# a hole opened for nobody. It exists for the one deployment shape that needs
# it: a frontend on a static host talking to this API on another.
if config.ALLOWED_ORIGINS:
    from fastapi.middleware.cors import CORSMiddleware

    app.add_middleware(
        CORSMiddleware,
        # Explicit origins, never "*" — the studio sends a bearer token, and a
        # wildcard origin with credentials is the classic way to hand a session
        # to whichever page asks for it.
        allow_origins=config.ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )

# The platform API is served by both roles. On the edge it reads the local
# files that sync keeps up to date, so a kiosk boots with no network at all.
app.include_router(platform.router)

# Everything that changes something, behind a token. Split by trust rather than
# by topic: a cabinet is physically reachable by the public and calls only the
# router above, so the boundary is visible in the import list.
app.include_router(studio.router)

# Conversation needs a model — but not necessarily one on this machine.
#
# The edge role has Ollama and Whisper locally, which is the design: a showroom
# cabinet must keep talking when the network drops. The cloud role has neither,
# and used to mean the deployed platform simply could not hold a conversation.
#
# With a hosted provider configured it can. `llm.py` and `stt.py` resolve which
# implementation answers; nothing here or above them knows which it is. The
# import stays conditional because `stt.py` pulls faster-whisper the moment it
# actually needs it, and a cloud image has no reason to carry that.
SERVES_CONVERSATION = IS_EDGE or config.hosted_models()

if SERVES_CONVERSATION:
    from backend.routes import conversation

    app.include_router(conversation.router)
    conversation.warm()

if IS_EDGE:
    from backend import sync

    sync.start()

# A deployed container usually has no persistent disk, and `catalog.db` is kept
# out of the image because it holds password hashes. Without this the first thing
# anyone sees on a fresh deploy is an empty showroom. Runs only when the catalog
# is genuinely empty, so it can never overwrite a real one.
try:
    from backend import ingest

    _seeded = ingest.seed_if_empty() if config.SEED_SAMPLE else 0
    if _seeded:
        print(f"  seeded {_seeded} sample products (catalog was empty)")
except Exception as _error:  # never block startup on sample data
    print(f"  could not seed the sample catalog: {_error}")

print(f"\nLuxora — services\n{config.report()}\n")


# Serve the built UI whenever there is one, whatever the role.
#
# This used to be edge-only, on the reasoning that a cabinet serves its own
# footage so clips never cross the network or an egress bill. That reasoning is
# about *media*, and it still holds — media is not synced and does not live here.
# It was never a reason to withhold the HTML, and withholding it meant a cloud
# deployment served an API with no way to look at it, which forces either a
# second host and a CORS policy or a reviewer running a build locally.
#
# A cloud image simply has no `dist/` unless one was built into it, so this is
# self-limiting rather than conditional.
# Avatar media is written at runtime and must be served from where it is
# written, not from the build output.
#
# Vite copies `frontend/public/` into `frontend/dist/` when the bundle is built.
# Everything the Studio uploads — posters, clips, campaign media — lands in
# `public/`, because that is where `store.py` reads an avatar's metadata from and
# the two must not disagree. Serving only `dist/` therefore meant every upload
# 404'd until somebody happened to run `npm run build`: the Studio showed four
# green clips while the cabinet showed a placeholder silhouette.
#
# Mounted before the catch-all below so it wins, and pointed at `public/` so an
# upload is live the moment it is written.
# Uploads, so the data root — inside a packaged app the bundle itself is
# read-only and this is the one of the two that a customer writes to.
RUNTIME_MEDIA = config.DATA / "frontend" / "public" / "avatars"
if RUNTIME_MEDIA.is_dir():
    app.mount("/avatars", StaticFiles(directory=RUNTIME_MEDIA), name="avatars")

if FRONTEND_DIST.is_dir():

    @app.get("/studio{rest:path}", include_in_schema=False)
    def studio(rest: str):
        """StaticFiles has no history fallback, so a hard refresh on /studio would
        404. One route rather than a client-side router nobody else needs."""
        return FileResponse(FRONTEND_DIST / "index.html")

    @app.get("/", include_in_schema=False)
    def root():
        """The kiosk — unless there is nobody to show yet.

        A fresh install has no avatars, so `/api/kiosk/{id}` 404s and the panel
        came up blank reading "The showroom is offline". It is not offline, it is
        empty, and the person who just installed it has no way to guess that the
        thing they need is at a URL nobody mentioned.

        Registered before the mount below, because a mount at "/" would otherwise
        answer first. It stops redirecting the moment one avatar exists, so a
        real cabinet is never bounced away from its own screen.
        """
        if not store.list_avatars():
            return RedirectResponse("/studio")
        return FileResponse(FRONTEND_DIST / "index.html")

    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
