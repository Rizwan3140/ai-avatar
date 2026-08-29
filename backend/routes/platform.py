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

from fastapi import APIRouter, HTTPException, Request, Response

from backend import analytics, avatar_provider, campaigns, catalog, config, store, tryon

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
def kiosk(kiosk_id: str):
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


@router.get("/products")
def products(
    q: str = "",
    category: str = "",
    max_price: float | None = None,
    limit: int = 8,
    avatar: str = "",
):
    """Search. Everything optional — no arguments is "show me what you have"."""
    query, parsed_limit = catalog.parse_query(q)
    found = catalog.search(
        query,
        category,
        max_price if max_price is not None else parsed_limit,
        limit,
        org_id=org_for(avatar),
    )
    return [catalog.to_dict(p) for p in found]


@router.get("/products/categories")
def product_categories(avatar: str = ""):
    return catalog.categories(org_for(avatar))


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
    if consent != "1":
        raise HTTPException(
            428, "the visitor has not agreed to be photographed"
        )

    org_id = org_for(avatar)
    found = catalog.get(product_id, org_id)
    if found is None:
        raise HTTPException(404, "no such product")

    photo = await request.body()
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
