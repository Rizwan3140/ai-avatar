"""The conversation API — speech in, speech out.

Runs at the edge, on the machine that drives the panel. Everything here needs a
model in memory, so none of it belongs in a cloud container: a GPU instance idling
through a showroom's quiet hours costs more than the entire rest of the platform.

Keeping it local also means the conversation survives the network going down,
which is the failure a showroom actually experiences.
"""

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend import analytics, catalog, documents, llm, memory, stt
from backend.routes.platform import avatar_or_404

router = APIRouter(prefix="/api", tags=["conversation"])


class ChatRequest(BaseModel):
    message: str
    avatar_id: str = ""
    #: One visitor's conversation. Two cabinets sharing a backend must not share
    #: a history, and one person leaving must not clear another's.
    session: str = "default"
    #: What is currently on the screen. Without it, "is that good for gaming?"
    #: reaches the model with no idea what "that" refers to.
    context: str = ""


class ResetRequest(BaseModel):
    session: str = "default"


class SpeakRequest(BaseModel):
    text: str
    #: Whose voice. Never a path or a filename — the reference recording is
    #: resolved from the avatar, so a request cannot name a file to read.
    avatar_id: str


def warm() -> None:
    """Load both models in the background, so the first visitor does not wait out
    a cold start in the middle of their sentence."""
    stt.warm()
    llm.warm()


@router.post("/chat")
def chat(req: ChatRequest):
    avatar = avatar_or_404(req.avatar_id)
    # The org comes from the avatar this cabinet is showing, never from the
    # request. One showroom's avatar quoting another showroom's prices out loud is
    # the worst outcome tenancy exists to prevent.
    org_id = avatar.org_id

    # Catalog first, model second. Retrieval happens here rather than inside
    # llm.py so the provider seam stays a pure "messages in, text out" contract.
    query, max_price = catalog.parse_query(req.message)
    # "Have you got this in red" and "something for a wedding" are filters the
    # catalog can apply exactly, so they are lifted out of the text rather than
    # left for keyword search to approximate.
    query, color, style = catalog.parse_facets(query)
    products = catalog.search(
        query, max_price=max_price, org_id=org_id, color=color, style=style
    )

    # And the company's own documents, for the half of showroom questions no
    # product row can answer — delivery, returns, warranty, opening hours.
    passages = documents.search(query, org_id=org_id)

    # What was asked and what it matched. A question that matched nothing is the
    # most useful line in the whole log — it is a customer wanting something the
    # company does not stock.
    analytics.record(
        "question",
        session=req.session,
        avatar=avatar.id,
        org=org_id,
        text=req.message,
        results=len(products),
        passages=len(passages),
    )
    for product in products:
        analytics.record("product_shown", product=product.id, name=product.name, org=org_id)

    memory.add_message(req.session, "user", req.message)

    def generate():
        reply = ""
        # When nothing matched, hold the reply back and check it before it is
        # spoken. The model claims to stock things we do not sell — with invented
        # brands and invented prices — often enough that the prompt cannot be the
        # only thing standing between a customer and a lie. See
        # `llm.ungrounded_claim`.
        #
        # The cost is first-audio latency, and it is paid only on turns that
        # matched no product, where there is nothing to put on screen and nothing
        # to look at while he thinks. Turns that found something still stream.
        withhold = not products

        for chunk in llm.stream_reply(
            memory.get_history(req.session),
            avatar.persona,
            products,
            req.context,
            documents.as_context(passages),
        ):
            reply += chunk
            if not withhold:
                yield chunk

        if withhold:
            if llm.ungrounded_claim(reply, products):
                analytics.record(
                    "ungrounded_claim", session=req.session, avatar=avatar.id,
                    org=org_id, text=req.message, said=reply[:200],
                )
                reply = llm.REFUSAL
            yield reply

        memory.add_message(req.session, "assistant", reply)

    return StreamingResponse(
        generate(),
        media_type="text/plain",
        # The UI needs to know which products to put on screen, and it must not
        # wait for the reply to finish streaming to find out.
        headers={"X-Products": ",".join(p.id for p in products)},
    )


@router.post("/listen")
async def listen(request: Request):
    """Raw audio in, text out. Bytes on the body rather than multipart, so this
    needs no extra dependency and no encoding round trip."""
    audio = await request.body()
    if not audio:
        return {"text": ""}
    partial = request.query_params.get("partial") == "1"
    # Transcription is CPU-bound; keep it off the event loop.
    text = await run_in_threadpool(stt.transcribe, audio, partial)
    return {"text": text}


@router.get("/voice")
def voice_status(avatar: str = ""):
    """Whether this cabinet speaks in its own voice or the browser's.

    Asked once at boot, before a word is spoken, because the answer decides
    which synthesiser the page uses for the whole session. Public for the same
    reason `/api/tryon` is: the cabinet needs it and there is nothing to protect.
    """
    from backend import tts

    return tts.status(avatar)


@router.post("/speak")
def speak(req: SpeakRequest):
    """One sentence, as audio, in the avatar's cloned voice.

    A sentence rather than a whole reply. The browser already speaks each
    sentence as it arrives from the model — that is what puts the first word
    under a second — and generating a whole answer before any of it is heard
    would trade that away.
    """
    from backend import tts

    try:
        audio = tts.speak(req.text, req.avatar_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except tts.VoiceUnavailable as exc:
        # 503, not 500: a voice that is not configured is a capability that is
        # switched off, and the browser falls back to its own synthesiser rather
        # than the cabinet going silent.
        raise HTTPException(503, str(exc)) from exc

    return Response(
        content=audio,
        media_type="audio/wav",
        # Sentences repeat — a greeting, a refusal — and re-generating one the
        # machine has already said is a second of silence for nothing.
        headers={"Cache-Control": "private, max-age=3600"},
    )


@router.post("/reset")
def reset(req: ResetRequest | None = None):
    """A visitor walked away. The next one starts a conversation, not a
    continuation — and nobody else's is touched."""
    memory.clear(req.session if req else "default")
    return {"ok": True, "active_sessions": memory.active()}
