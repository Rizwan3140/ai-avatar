"""The open API — what a cabinet on a showroom floor is allowed to call.

Runs in the cloud as well as at the edge. Deliberately imports nothing that needs
a model, a GPU or a microphone, so the deployed image stays small and the machine
stays cheap.

Nothing here changes anything an operator owns. A kiosk is physically reachable by
the public and has no user to log in as, so it reads its own configuration, reads
the catalog, and records that something was looked at. Everything that writes is
in `studio.py`, behind a token.

**Every read is scoped to an org**, resolved from the avatar the cabinet is
showing rather than from a parameter the caller chooses. A tenant id that arrives
on the query string is not a tenant id; it is a way to read someone else's
catalog.
"""

from dataclasses import asdict

from fastapi import APIRouter, HTTPException, Query, Request, Response

from backend import (
    analytics,
    avatar_provider,
    campaigns,
    catalog,
    config,
    seasons,
    selfie,
    store,
    tryon,
)

router = APIRouter(prefix="/api", tags=["platform"])


def avatar_or_404(avatar_id: str) -> store.Avatar:
    avatar = store.get_avatar(avatar_id) if avatar_id else store.default_avatar()
    if avatar is None:
        raise HTTPException(404, "no avatars exist yet")
    return avatar


def org_for(avatar_id: str = "") -> str:
    """Which catalog this cabinet is looking at.

    Resolved from the avatar, never from a parameter the caller chooses.

    A blank or unknown avatar id used to fall through to `default_avatar()`,
    which is whichever avatar sorts first on the box. With one customer that was
    the single-avatar install; with two it meant a cabinet whose identity call
    failed read the *other* company's catalog — and fed it to the model. There is
    no safe org to guess, so an unresolvable avatar is refused.
    """
    avatar = store.get_avatar(avatar_id) if avatar_id else store.default_avatar()
    if avatar is None:
        raise HTTPException(404, "no avatars exist yet")
    return avatar.org_id


@router.get("/kiosk/{kiosk_id}")
def kiosk(kiosk_id: str, request: Request):
    """Everything a cabinet needs to come up. An unregistered kiosk gets the
    default avatar rather than an error — a showroom screen showing nothing is
    worse than one showing the wrong person."""
    k = store.get_kiosk(kiosk_id)
    return {
        "kiosk": asdict(k),
        "avatar": asdict(avatar_or_404(k.avatar_id)),
        # The cabinet decides whether to offer a camera at all, and it should not
        # have to make a second call to find out.
        "tryon": tryon.status(),
        # The same for a selfie with the avatar, and whether a phone can be
        # handed the result.
        "selfie": selfie.status(str(request.base_url)),
        # And what the showroom is wearing today. Arrives with identity so a
        # cabinet is never briefly dressed for the wrong month while a second
        # request is in flight, and so it survives on last-known-good config
        # when there is no network to ask.
        "season": seasons.active(k.org_id),
        # Whether this machine has a studio worth going back to. A workstation
        # does; a cabinet in a mall does not, and the wordmark on its panel must
        # not be a door into the dashboard for whoever is standing in front of
        # it. Same value that decides what `/` opens, so the two cannot disagree.
        "home": config.HOME,
    }


@router.get("/avatar")
def get_avatar(id: str = ""):
    return asdict(avatar_or_404(id))


@router.get("/campaigns/{avatar_id}")
def campaigns_for(avatar_id: str):
    """What should play while nobody is talking, right now. The time filter is
    applied server-side so a kiosk left running for weeks picks up the evening
    campaign without a reload."""
    return [campaigns.to_dict(c) for c in campaigns.for_avatar(avatar_id)]


@router.get("/providers")
def providers():
    return {"available": avatar_provider.available(), "configured": config.AVATAR_PROVIDER}


@router.get("/kiosk/{kiosk_id}/catalog")
def kiosk_catalog(kiosk_id: str):
    """This cabinet's whole catalog, for the sync loop to mirror.

    Scoped exactly as `/api/kiosk/{id}` is: the org comes from the kiosk's own
    avatar, never from a parameter. A cabinet asks what *it* should be selling,
    keyed by an id it already has — which is what makes this safe to leave
    public alongside the identity call it sits beside.

    Unpaginated on purpose. The catalog it is mirroring is a few hundred rows
    after pruning, and a half-applied page is a showroom missing its lehengas:
    `catalog.replace` is all-or-nothing precisely because this is.

    Registered cabinets only. `store.get_kiosk` answers an unknown id with the
    default avatar, which is the right call for the identity route beside this
    one — a screen showing the wrong person beats a screen showing nothing. It
    is the wrong call here: it made `GET /api/kiosk/anything-at-all/catalog`
    hand a stranger some org's entire product list, prices included, with no
    credential and nothing to guess. A cabinet nobody registered has no catalog
    to mirror, so saying so is both safer and truer.
    """
    if kiosk_id not in store.list_kiosks():
        raise HTTPException(404, "no cabinet is registered under that id")
    k = store.get_kiosk(kiosk_id)
    org_id = avatar_or_404(k.avatar_id).org_id
    return {
        "org_id": org_id,
        "products": [catalog.to_dict(p) for p in catalog.all_products(org_id)],
    }


@router.get("/products")
def products(
    q: str = "",
    category: str = "",
    max_price: float | None = None,
    # Bounded. `limit` is multiplied by FAN_OUT before it reaches SQLite, so an
    # unbounded one is a way to ask a public endpoint for the whole table.
    limit: int = Query(8, ge=1, le=100),
    avatar: str = "",
    color: str = "",
    style: str = "",
    # "men", "women" or "accessories". A tapped tile names its shelf *and* its
    # department, so the men's Pants tile opens the one men's pant and not the
    # two women's pieces filed on the same shelf.
    department: str = "",
):
    """Search. Everything optional — no arguments is "show me what you have"."""
    query, parsed_limit = catalog.parse_query(q)
    # An explicit colour or style always wins over one found in the text: the
    # caller ticking a filter has said what they mean, and re-reading the words
    # would let "red" typed in the box quietly override the box beside it.
    query, said_color, said_style = catalog.parse_facets(query)
    found = catalog.search(
        query,
        category,
        max_price if max_price is not None else parsed_limit,
        limit,
        org_id=org_for(avatar),
        color=color or said_color,
        style=style or said_style,
        department=department,
    )
    return [catalog.to_dict(p) for p in found]


@router.get("/products/categories")
def product_categories(avatar: str = ""):
    return catalog.categories(org_for(avatar))


@router.get("/products/shelves")
def product_shelves(department: str, avatar: str = "", color: str = ""):
    """One department's shelves, as the tiles a visitor chooses from.

    Declared before `/products/{product_id}`, like the routes around it, or
    "shelves" would be looked up as a product id. Scoped as every read here is:
    the org comes from the avatar.

    With a colour, the shelves that hold a piece in it. It is handed back so a
    tapped tile opens the black kurtas and not the whole shelf.
    """
    return {
        "department": department,
        "color": color,
        "title": f"{color.title()} {catalog.DEPARTMENT_LABELS.get(department, '')}".strip(),
        "shelves": catalog.tiles(org_for(avatar), department, color),
    }


@router.get("/products/colors")
def product_colors(avatar: str = ""):
    """The colours this catalog actually stocks, for a filter that never comes
    back empty."""
    return catalog.colors(org_for(avatar))


@router.get("/products/styles")
def product_styles(avatar: str = ""):
    return catalog.styles(org_for(avatar))


@router.get("/products/{product_id}")
def product(product_id: str, avatar: str = ""):
    found = catalog.get(product_id, org_for(avatar))
    if found is None:
        raise HTTPException(404, "no such product")
    return catalog.to_dict(found)


@router.get("/products/{product_id}/qr")
def product_qr(product_id: str, avatar: str = ""):
    """The product's link as a QR, rendered here rather than by a web service.

    A hosted QR image would be the one thing on the whole screen that goes blank
    when the network drops — in the app whose entire architecture exists to
    survive exactly that.
    """
    import io

    import segno

    found = catalog.get(product_id, org_for(avatar))
    if found is None or not found.url:
        raise HTTPException(404, "no link for this product")

    buffer = io.BytesIO()
    # Medium correction: a phone camera reads it through glass and at an angle,
    # which is not the clean scan the default level assumes.
    segno.make(found.url, error="m").save(buffer, kind="svg", scale=4, border=0, dark="#111111")
    return Response(
        content=buffer.getvalue(),
        media_type="image/svg+xml",
        headers={"Cache-Control": "public, max-age=86400"},
    )


@router.post("/analytics/viewed/{product_id}")
def product_viewed(product_id: str, avatar: str = ""):
    """A visitor opened this product's detail — a stronger signal of interest
    than it merely appearing in a list of results."""
    org_id = org_for(avatar)
    found = catalog.get(product_id, org_id)
    analytics.record(
        "product_viewed", product=product_id, name=found.name if found else "", org=org_id
    )
    return {"ok": True}


@router.get("/tryon")
def tryon_status():
    """Whether a camera should be offered, and whether the photo leaves the room.

    Public because the cabinet needs it before it draws a button, and because a
    person deciding whether to be photographed is entitled to the answer.
    """
    return tryon.status()


@router.post("/tryon/consent")
def tryon_consent():
    """A visitor pressed "yes, take a photo". Returns the token that authorises
    exactly one try-on, for the next few minutes.

    Issued by the server so that agreement is something this machine observed,
    rather than something the caller asserts on every request.
    """
    if not tryon.available():
        raise HTTPException(503, "try-on is not switched on here")
    return {"consent": tryon.issue_consent(), "expires_in": tryon.CONSENT_TTL}


@router.post("/tryon/{product_id}")
async def try_on(product_id: str, request: Request, avatar: str = "", consent: str = ""):
    """A photo of a visitor, wearing the garment they are looking at.

    The image arrives as raw bytes on the body and leaves as raw bytes in the
    response. It is never written to disk, never cached, and never reaches the
    event log — the log records that a try-on happened and for which product,
    which is what a showroom manager needs and is not personal data.

    Consent is a required query parameter with no default. A request without it
    is rejected rather than assumed, because the assumption is the whole risk.
    """
    # A token from `/api/tryon/consent`. It used to be the literal "1", which
    # the browser put on every request — so the parameter proved that a client
    # had been written, never that a person had agreed.
    #
    # Absence is refused here, before anything else happens. The token itself is
    # spent further down, once there is actually a photograph to process: a
    # visitor who agreed and then hit a missing product should not have to be
    # asked again because a lookup failed.
    if not consent:
        raise HTTPException(428, "the visitor has not agreed to be photographed")

    org_id = org_for(avatar)
    found = catalog.get(product_id, org_id)
    if found is None:
        raise HTTPException(404, "no such product")

    photo = await request.body()

    # Spent, once, at the last moment before the photograph is used.
    if not tryon.consume_consent(consent):
        raise HTTPException(
            428, "that agreement has expired or was already used - ask again"
        )

    try:
        result = tryon.try_on(
            photo,
            garment_url=found.image,
            description=f"{found.name} {found.category}".strip(),
            consent=True,
        )
    except tryon.ConsentMissing as exc:
        raise HTTPException(428, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except tryon.TryOnUnavailable as exc:
        # 503, not 500: this is a capability that is not switched on, and the
        # kiosk should say so plainly rather than showing an error.
        raise HTTPException(503, str(exc)) from exc

    analytics.record(
        "tryon", product=product_id, name=found.name,
        # Which agreement authorised this. Not a person and not an image — the
        # one fact that was missing when consent lived only in the browser.
        consent=consent[:12],
        provider=result.provider, seconds=round(result.seconds, 1),
        # Without this the try-on landed in the default org's summary, so one
        # company's dashboard counted another company's try-ons.
        org=org_id,
    )
    return Response(
        content=result.image,
        media_type=result.media_type,
        # Never cached. The response is a photograph of a member of the public.
        headers={"Cache-Control": "no-store"},
    )


@router.get("/selfie")
def selfie_status(request: Request):
    """Whether a selfie is offered here, and whether it can go to a phone."""
    return selfie.status(str(request.base_url))


@router.post("/selfie/consent")
def selfie_consent():
    """A visitor pressed "share to my phone". Returns the token that authorises
    exactly one upload.

    The selfie itself needs no agreement from this machine: it is taken and
    composed in the browser and goes nowhere. This is the moment a photograph
    of a member of the public would leave the screen, so this is the moment
    recorded — the same nonce try-on uses, for the same reason.
    """
    if not config.SELFIE_ENABLED:
        raise HTTPException(503, "selfies are not switched on here")
    return {"consent": tryon.issue_consent(), "expires_in": tryon.CONSENT_TTL}


@router.post("/selfie")
async def selfie_share(request: Request, avatar: str = "", consent: str = ""):
    """Hold one composed selfie for a day, so a phone can fetch it.

    In memory only — see `backend/selfie.py`. The event log records that a
    selfie was shared and under which agreement, never the picture.
    """
    if not config.SELFIE_ENABLED:
        raise HTTPException(503, "selfies are not switched on here")
    if not consent:
        raise HTTPException(428, "the visitor has not agreed to share this photograph")
    org_id = org_for(avatar)
    if not selfie.public_base(str(request.base_url)):
        # Before the photograph is read: holding a picture nobody can fetch is
        # keeping a stranger's photo for no reason at all.
        raise HTTPException(503, "this cabinet has no address a phone can reach")

    # Refused by its declared size before a byte of it is read.
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > selfie.MAX_IMAGE:
        raise HTTPException(413, "that photograph is too large")
    photo = await request.body()

    # Spent, once, at the last moment before the photograph is kept.
    if not tryon.consume_consent(consent):
        raise HTTPException(428, "that agreement has expired or was already used - ask again")
    try:
        token = selfie.hold(photo)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    analytics.record("selfie_shared", consent=consent[:12], org=org_id)
    return {"id": token, "expires_in": selfie.TTL}


@router.get("/selfie/{token}")
def selfie_photo(token: str):
    """What the QR code opens on the visitor's phone: their picture."""
    found = selfie.fetch(token)
    if found is None:
        raise HTTPException(404, "that photograph is no longer here")
    image, media_type = found
    return Response(
        content=image,
        media_type=media_type,
        headers={
            # A photograph of a member of the public: nobody's cache keeps it.
            "Cache-Control": "no-store",
            "Content-Disposition": 'inline; filename="selfie.jpg"',
        },
    )


@router.get("/selfie/{token}/qr")
def selfie_qr(token: str, request: Request):
    """The photograph's address as a QR, rendered here like a product's."""
    import io

    import segno

    base = selfie.public_base(str(request.base_url))
    if selfie.fetch(token) is None or not base:
        raise HTTPException(404, "that photograph is no longer here")

    buffer = io.BytesIO()
    segno.make(f"{base}/api/selfie/{token}", error="m").save(
        buffer, kind="svg", scale=4, border=0, dark="#111111"
    )
    return Response(
        content=buffer.getvalue(),
        media_type="image/svg+xml",
        headers={"Cache-Control": "no-store"},
    )


@router.get("/health")
def health():
    """Also reports whether the models are loaded.

    A cold faster-whisper takes about eleven seconds and a cold Ollama about ten.
    Both are warmed at boot in the background, but until they finish the first
    visitor pays the whole load — so `ready` is the difference between "the
    process is up" and "you can demonstrate this now".
    """
    models = True
    if config.ROLE in ("edge", "all"):
        # Edge-only import: a cloud container has no faster-whisper to ask.
        from backend import stt

        models = stt.ready()

    return {
        "ok": True,
        "role": config.ROLE,
        # What this machine is running, so "did my update land" is a question
        # with an answer rather than a guess from behaviour.
        "version": config.version(),
        "home": config.HOME,
        "avatars": len(store.list_avatars()),
        "models_ready": models,
        # Whether the browser should keep re-transcribing a turn in progress.
        #
        # It costs nothing when the model is on this machine. It costs real money
        # and real bandwidth when it is not: a partial re-encodes the whole turn
        # so far, every 1.2 seconds, so a ten-second sentence uploads about forty
        # seconds of audio across eight requests — for a live caption that only
        # ever reaches the dev-only transcript panel. No visitor sees it.
        "partials": config.stt_provider() == "whisper",
    }
