"""Everything behind a login.

Split from `platform.py` by trust, not by topic. A cabinet on a showroom floor is
physically reachable by the public and has no user to log in, so the routes it
calls must stay open; every route that *changes* something lives here and needs a
token. Two files makes that boundary something you can see rather than something
you have to check per-route.

The org comes from the token, never from the request body. A tenant id a caller
can name is not a tenant id — it is a parameter for reading someone else's data.
"""

from dataclasses import asdict

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel

from backend import accounts, analytics, campaigns, catalog, config, documents, store, tryon
from backend.accounts import AuthError, Principal

router = APIRouter(prefix="/api", tags=["studio"])


# --- who is calling ----------------------------------------------------------


def principal(authorization: str = Header(default="")) -> Principal:
    """The caller, or a 401.

    With no accounts on the machine this returns a default owner: that is the
    single-kiosk install that exists today, where demanding a login before anyone
    can create one is a locked door with the key inside. The first account closes
    it for good.
    """
    if not accounts.any_users():
        return Principal(
            user_id="local", email="", org_id=accounts.DEFAULT_ORG, role="owner"
        )

    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(401, "sign in to continue")
    try:
        return accounts.verify_token(token)
    except AuthError as exc:
        raise HTTPException(401, str(exc)) from exc


def editor(caller: Principal = Depends(principal)) -> Principal:
    if not caller.may_write:
        raise HTTPException(403, "your account can view this but not change it")
    return caller


def owner(caller: Principal = Depends(principal)) -> Principal:
    if caller.role != "owner":
        raise HTTPException(403, "only an owner can do this")
    return caller


def _mirrored() -> None:
    """A kiosk syncing from a platform holds a replica, not the original.

    Accepting an edit here would save it, look successful, and be overwritten at
    the next sync — the worst kind of failure, because the person who made the
    change has already walked away believing it took.
    """
    if config.PLATFORM_URL:
        raise HTTPException(
            409,
            f"This kiosk mirrors {config.PLATFORM_URL} and would overwrite the change "
            f"at the next sync. Edit it on the platform instead.",
        )


# --- accounts ----------------------------------------------------------------


class SignupRequest(BaseModel):
    email: str
    password: str
    org_name: str = ""
    vertical: str = ""


class LoginRequest(BaseModel):
    email: str
    password: str


class MemberRequest(BaseModel):
    email: str
    password: str
    role: str = "editor"


@router.get("/auth/status")
def auth_status():
    """Whether this machine has any accounts. The studio uses it to decide between
    a sign-in form and a create-the-first-account form."""
    return {"open": not accounts.any_users()}


@router.post("/auth/signup")
def signup(req: SignupRequest):
    # After the first account exists, signup would let anyone on the network mint
    # themselves an org on this platform. Further accounts come from an owner.
    if accounts.any_users():
        raise HTTPException(403, "this platform already has accounts — ask an owner for one")
    try:
        caller = accounts.signup(req.email, req.password, req.org_name, req.vertical)
    except AuthError as exc:
        raise HTTPException(400, str(exc)) from exc
    _adopt_existing(caller.org_id)
    return {"token": accounts.issue_token(caller), **asdict(caller)}


def _adopt_existing(org_id: str) -> None:
    """Hand whatever was already on disk to the first org that signs up.

    Otherwise the machine's own avatars and catalog become invisible the moment
    somebody creates an account, which reads as data loss and is the first thing
    they would see.
    """
    if org_id == accounts.DEFAULT_ORG:
        return
    for avatar in store.list_avatars(store.DEFAULT_ORG):
        avatar.org_id = org_id
        store.save_avatar(avatar)
    for kiosk_id, entry in store.list_kiosks(store.DEFAULT_ORG).items():
        store.save_kiosk(
            store.Kiosk(kiosk_id, entry["avatar_id"], entry.get("label", ""), org_id)
        )
    catalog.reassign_org(store.DEFAULT_ORG, org_id)
    documents.reassign_org(store.DEFAULT_ORG, org_id)


@router.post("/auth/login")
def login(req: LoginRequest):
    try:
        caller = accounts.login(req.email, req.password)
    except AuthError as exc:
        raise HTTPException(401, str(exc)) from exc
    return {"token": accounts.issue_token(caller), **asdict(caller)}


@router.get("/auth/me")
def me(caller: Principal = Depends(principal)):
    return {**asdict(caller), "org": accounts.get_org(caller.org_id)}


@router.get("/studio/members")
def members(caller: Principal = Depends(principal)):
    return accounts.list_members(caller.org_id)


@router.post("/studio/members")
def add_member(req: MemberRequest, caller: Principal = Depends(owner)):
    try:
        added = accounts.add_member(caller.org_id, req.email, req.password, req.role)
    except AuthError as exc:
        raise HTTPException(400, str(exc)) from exc
    return asdict(added)


@router.delete("/studio/members/{user_id}")
def remove_member(user_id: str, caller: Principal = Depends(owner)):
    try:
        accounts.remove_member(caller.org_id, user_id)
    except AuthError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"ok": True}


class OrgPatch(BaseModel):
    vertical: str | None = None


@router.patch("/studio/org")
def update_org(patch: OrgPatch, caller: Principal = Depends(owner)):
    if patch.vertical is not None:
        accounts.set_vertical(caller.org_id, patch.vertical)
    return accounts.get_org(caller.org_id)


# --- avatars -----------------------------------------------------------------


class AvatarPatch(BaseModel):
    name: str | None = None
    persona: str | None = None
    greeting: str | None = None
    language: str | None = None
    voice: str | None = None
    renderer: str | None = None


class AvatarCreate(BaseModel):
    name: str
    greeting: str = ""
    persona: str = ""
    language: str = "en-US"


def _avatar_or_404(avatar_id: str, caller: Principal) -> store.Avatar:
    avatar = store.get_avatar(avatar_id, caller.org_id)
    if avatar is None:
        raise HTTPException(404, "no such avatar")
    return avatar


def _with_status(avatar: store.Avatar) -> dict:
    return {**asdict(avatar), "ready": avatar.ready, "missing_clips": avatar.missing_clips}


@router.get("/studio/avatars")
def list_avatars(caller: Principal = Depends(principal)):
    return [_with_status(a) for a in store.list_avatars(caller.org_id)]


@router.post("/studio/avatars")
def create_avatar(req: AvatarCreate, caller: Principal = Depends(editor)):
    _mirrored()
    if not req.name.strip():
        raise HTTPException(400, "an avatar needs a name")
    avatar = store.create_avatar(
        req.name,
        caller.org_id,
        greeting=req.greeting,
        persona=req.persona,
        language=req.language,
    )
    return _with_status(avatar)


@router.patch("/studio/avatars/{avatar_id}")
def update_avatar(avatar_id: str, patch: AvatarPatch, caller: Principal = Depends(editor)):
    _mirrored()
    avatar = _avatar_or_404(avatar_id, caller)
    for key, value in patch.model_dump(exclude_none=True).items():
        setattr(avatar, key, value)
    return _with_status(store.save_avatar(avatar))


@router.delete("/studio/avatars/{avatar_id}")
def delete_avatar(avatar_id: str, caller: Principal = Depends(owner)):
    _mirrored()
    if not store.delete_avatar(avatar_id, caller.org_id):
        raise HTTPException(404, "no such avatar")
    return {"ok": True}


@router.post("/studio/avatars/{avatar_id}/photo")
async def upload_photo(
    avatar_id: str, request: Request, caller: Principal = Depends(editor)
):
    """A photograph in, a poster out.

    Raw bytes on the body rather than multipart — the same choice `/api/listen`
    makes, and for the same reason: multipart would mean a `python-multipart`
    dependency for one field.

    The cut-out runs `make_poster.py`, which already knows the framing the
    renderer expects and the white-background trap. Importing it here rather than
    reimplementing means one place gets that right.
    """
    _mirrored()
    avatar = _avatar_or_404(avatar_id, caller)
    image = await request.body()
    if not image:
        raise HTTPException(400, "no image on the request body")
    if len(image) > 25 * 1024 * 1024:
        raise HTTPException(413, "that photo is over 25 MB — resize it first")

    waist_up = request.query_params.get("waist_up") == "1"
    folder = store.avatar_dir(avatar.id)
    folder.mkdir(parents=True, exist_ok=True)
    source = folder / "source-photo"
    source.write_bytes(image)

    try:
        # rembg and Pillow are edge-only; a cloud container has neither, and
        # importing at module level would drag them into that image.
        from fastapi.concurrency import run_in_threadpool

        import make_poster

        await run_in_threadpool(make_poster.make, source, avatar.id, waist_up)
    except ImportError as exc:
        raise HTTPException(
            501,
            "This machine cannot cut out a photo — rembg and Pillow are installed "
            "on the edge role only. Upload from the kiosk, or run make_poster.py.",
        ) from exc
    except SystemExit as exc:
        # make_poster raises this when the cut-out finds no subject.
        raise HTTPException(422, str(exc) or "no subject found in that photo") from exc
    finally:
        source.unlink(missing_ok=True)

    return _with_status(_avatar_or_404(avatar_id, caller))


@router.post("/studio/avatars/{avatar_id}/clips/{pose}")
async def upload_clip(
    avatar_id: str, pose: str, request: Request, caller: Principal = Depends(editor)
):
    """A raw generated clip in, installed footage out.

    This was command-line only, which meant the one thing standing between an
    avatar and being believable — the three poses that are not idle — could not
    be added by the person who commissioned the footage.

    The bytes go through `conform_footage.conform()` rather than to disk, because
    a raw generator clip is not usable as it arrives. That function crops to 9:16,
    forces full-range output so #FFFFFF does not decode to ~#EBEBEB, strips the
    audio track, and — the reason it exists — ping-pongs the clip so it loops
    without a visible seam. Generators do not produce loopable footage, and a
    seam every few seconds is the fastest way to stop reading as a person.

    Slow on purpose: `-preset slow -crf 18`. A ten-second clip takes tens of
    seconds, which is why it runs off the event loop.
    """
    _mirrored()
    avatar = _avatar_or_404(avatar_id, caller)
    if pose not in store.POSES:
        raise HTTPException(400, f"pose must be one of {', '.join(store.POSES)}")

    clip = await request.body()
    if not clip:
        raise HTTPException(400, "no clip on the request body")
    # Generous: conformed footage is ~11 MB and a raw 4K generator clip is larger.
    if len(clip) > 200 * 1024 * 1024:
        raise HTTPException(413, "that clip is over 200 MB")

    folder = store.avatar_dir(avatar.id)
    folder.mkdir(parents=True, exist_ok=True)
    source = folder / f"upload-{pose}.src"
    source.write_bytes(clip)

    try:
        from fastapi.concurrency import run_in_threadpool

        import conform_footage

        await run_in_threadpool(conform_footage.conform, [source], pose, folder)

        # A first frame is only worth taking when there is no poster yet. An
        # existing one came from a cut-out photograph, which is on true white;
        # a video frame is not, and silently replacing the better one would put
        # the grey-rectangle bug back.
        if pose == "idle" and not (folder / "poster.png").exists():
            await run_in_threadpool(conform_footage.poster_from, folder / "idle.mp4", folder)
    except FileNotFoundError as exc:
        raise HTTPException(
            501,
            "ffmpeg is not on this machine's PATH, and conforming footage needs it. "
            "Install ffmpeg, or run conform_footage.py where it is available.",
        ) from exc
    except SystemExit as exc:
        # conform_footage raises this when ffmpeg rejects the input.
        raise HTTPException(
            422, f"ffmpeg could not read that clip — is it really a video? ({exc})"
        ) from exc
    except Exception as exc:
        # Anything else ffmpeg or the filter graph throws is still a bad upload
        # rather than a broken server, and the person who picked the file is the
        # one who can fix it. Without this a mistyped file is a 500.
        raise HTTPException(
            422, f"could not conform that clip — is it really a video? ({type(exc).__name__})"
        ) from exc
    finally:
        source.unlink(missing_ok=True)

    return _with_status(_avatar_or_404(avatar_id, caller))


@router.delete("/studio/avatars/{avatar_id}/clips/{pose}")
def delete_clip(avatar_id: str, pose: str, caller: Principal = Depends(editor)):
    """Remove one pose. It falls back to idle, which is what a missing pose does
    anyway — so this is how you undo a clip that turned out wrong."""
    _mirrored()
    avatar = _avatar_or_404(avatar_id, caller)
    if pose not in store.POSES:
        raise HTTPException(400, f"pose must be one of {', '.join(store.POSES)}")

    target = store.avatar_dir(avatar.id) / f"{pose}.mp4"
    if not target.exists():
        raise HTTPException(404, "no such clip")
    target.unlink()
    return _with_status(_avatar_or_404(avatar_id, caller))


# --- kiosks ------------------------------------------------------------------


class KioskRequest(BaseModel):
    id: str
    avatar_id: str
    label: str = ""


@router.get("/studio/kiosks")
def list_kiosks(caller: Principal = Depends(principal)):
    return [
        {"id": k, **v} for k, v in store.list_kiosks(caller.org_id).items()
    ]


@router.put("/studio/kiosks/{kiosk_id}")
def save_kiosk(kiosk_id: str, req: KioskRequest, caller: Principal = Depends(editor)):
    _mirrored()
    # Assigning an avatar you cannot see would be a cross-tenant write dressed up
    # as a kiosk registration.
    _avatar_or_404(req.avatar_id, caller)
    existing = store.list_kiosks().get(kiosk_id)
    if existing and existing.get("org_id", store.DEFAULT_ORG) != caller.org_id:
        raise HTTPException(409, "that cabinet id is already registered")
    try:
        kiosk = store.save_kiosk(
            store.Kiosk(kiosk_id, req.avatar_id, req.label, caller.org_id)
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return asdict(kiosk)


@router.delete("/studio/kiosks/{kiosk_id}")
def delete_kiosk(kiosk_id: str, caller: Principal = Depends(editor)):
    _mirrored()
    if not store.delete_kiosk(kiosk_id, caller.org_id):
        raise HTTPException(404, "no such kiosk")
    return {"ok": True}


# --- catalog -----------------------------------------------------------------


class ProductRequest(BaseModel):
    id: str = ""
    name: str
    category: str = ""
    price: float | None = None
    currency: str = "INR"
    description: str = ""
    url: str = ""
    image: str = ""
    availability: str = "in_stock"
    attributes: dict[str, str] = {}


@router.get("/studio/products")
def studio_products(caller: Principal = Depends(principal)):
    return [catalog.to_dict(p) for p in catalog.all_products(caller.org_id)]


@router.put("/studio/products")
def save_product(req: ProductRequest, caller: Principal = Depends(editor)):
    _mirrored()
    from backend.ingest import slug

    product = catalog.Product(
        id=req.id.strip() or slug(req.name),
        name=req.name,
        category=req.category,
        price=req.price,
        currency=req.currency,
        description=req.description,
        url=req.url,
        image=req.image,
        availability=req.availability,
        attributes=req.attributes,
    )
    if not product.id:
        raise HTTPException(400, "a product needs a name")
    catalog.upsert([product], caller.org_id)
    return catalog.to_dict(product)


@router.delete("/studio/products/{product_id}")
def delete_product(product_id: str, caller: Principal = Depends(editor)):
    _mirrored()
    if not catalog.delete(product_id, caller.org_id):
        raise HTTPException(404, "no such product")
    return {"ok": True}


@router.post("/studio/import")
async def import_file(
    request: Request, filename: str = "", caller: Principal = Depends(editor)
):
    """A customer's file, straight onto the body.

    One route for both destinations. A CSV becomes products, a returns policy
    becomes passages, and a brochure with a spec table in it becomes both —
    `ingest.absorb` decides by shape, so the uploader does not have to know which
    kind of file they are holding.
    """
    _mirrored()
    from backend import ingest

    raw = await request.body()
    if not raw:
        raise HTTPException(400, "no file on the request body")

    name = filename or request.query_params.get("filename", "upload.csv")
    try:
        result = ingest.absorb(raw, name, caller.org_id)
    except ingest.UnsupportedFile as exc:
        raise HTTPException(415, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(422, f"could not read {name}: {exc}") from exc

    if not result["products"] and not result["passages"]:
        raise HTTPException(
            422, f"nothing usable in {name} — no name column, and no text to index"
        )
    return result


@router.get("/studio/knowledge")
def knowledge_sources(caller: Principal = Depends(principal)):
    """Documents the avatar can quote, and how much of each is indexed."""
    return documents.sources(caller.org_id)


@router.delete("/studio/knowledge/{source}")
def delete_knowledge(source: str, caller: Principal = Depends(editor)):
    _mirrored()
    if not documents.delete_source(source, caller.org_id):
        raise HTTPException(404, "no such document")
    return {"ok": True}


class CrawlRequest(BaseModel):
    url: str
    limit: int = 40


@router.post("/studio/products/crawl")
def crawl_site(req: CrawlRequest, caller: Principal = Depends(editor)):
    """Point the platform at a storefront and take what it already publishes."""
    _mirrored()
    from backend import crawl

    try:
        products = crawl.crawl(req.url, max_pages=req.limit)
    except Exception as exc:
        raise HTTPException(422, f"could not crawl {req.url}: {exc}") from exc
    if products:
        catalog.upsert(products, caller.org_id)
    return {"imported": len(products), "products": [catalog.to_dict(p) for p in products]}


# --- campaigns ---------------------------------------------------------------


class CampaignRequest(BaseModel):
    id: str
    src: str
    kind: str = "image"
    invitation: str = ""
    starts: str = ""
    ends: str = ""
    seconds: int = 8


@router.get("/studio/campaigns/{avatar_id}")
def studio_campaigns(avatar_id: str, caller: Principal = Depends(principal)):
    """Every campaign, including ones outside their time window — the kiosk
    endpoint filters by clock, and an editor needs to see the evening promotion
    at ten in the morning."""
    _avatar_or_404(avatar_id, caller)
    return [campaigns.to_dict(c) for c in campaigns.declared(avatar_id)]


@router.put("/studio/campaigns/{avatar_id}")
def save_campaigns(
    avatar_id: str, items: list[CampaignRequest], caller: Principal = Depends(editor)
):
    _mirrored()
    _avatar_or_404(avatar_id, caller)
    campaigns.save(avatar_id, [campaigns.Campaign(**i.model_dump()) for i in items])
    return [campaigns.to_dict(c) for c in campaigns.declared(avatar_id)]


@router.post("/studio/campaigns/{avatar_id}/media")
async def upload_campaign_media(
    avatar_id: str, request: Request, filename: str = "", caller: Principal = Depends(editor)
):
    _mirrored()
    _avatar_or_404(avatar_id, caller)
    raw = await request.body()
    name = filename or request.query_params.get("filename", "")
    if not raw or not name:
        raise HTTPException(400, "need a body and a ?filename=")
    try:
        src = campaigns.save_media(avatar_id, name, raw)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"src": src}


# --- try-on ------------------------------------------------------------------


@router.get("/studio/tryon")
def tryon_status(caller: Principal = Depends(principal)):
    return tryon.status()


# --- analytics ---------------------------------------------------------------


@router.get("/analytics")
def analytics_summary(days: int = 30, caller: Principal = Depends(principal)):
    """Behind a login now. It was public, which on a single-customer install was
    only a little careless and on a platform is one company reading another's
    questions off an open URL."""
    return analytics.summary(days, caller.org_id)


# --- diagnostics -------------------------------------------------------------


@router.get("/studio/summary")
def summary(caller: Principal = Depends(principal)):
    """One call for the studio's first paint. Four round trips on load is four
    chances for a spinner on a screen someone opens twenty times a day."""
    avatars = store.list_avatars(caller.org_id)
    return {
        "org": accounts.get_org(caller.org_id),
        "role": caller.role,
        "avatars": len(avatars),
        "incomplete": [a.id for a in avatars if a.missing_clips],
        "kiosks": len(store.list_kiosks(caller.org_id)),
        "products": len(catalog.all_products(caller.org_id)),
        "documents": documents.sources(caller.org_id),
        "tryon": tryon.status(),
        "mirrors": config.PLATFORM_URL,
    }


@router.get("/studio/export")
def export_org(caller: Principal = Depends(owner)):
    """Everything this org owns, as one JSON document.

    A customer who cannot get their catalog and personas back out is a customer
    who is locked in, and the whole product is a few files on a disk — there is no
    excuse for not offering it.
    """
    return {
        "org": accounts.get_org(caller.org_id),
        "avatars": [asdict(a) for a in store.list_avatars(caller.org_id)],
        "kiosks": store.list_kiosks(caller.org_id),
        "products": [catalog.to_dict(p) for p in catalog.all_products(caller.org_id)],
        "campaigns": {
            a.id: [campaigns.to_dict(c) for c in campaigns.declared(a.id)]
            for a in store.list_avatars(caller.org_id)
        },
    }


__all__ = ["router", "principal", "editor", "owner"]
