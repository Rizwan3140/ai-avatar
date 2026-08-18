"""The conversation API — speech in, speech out.

Runs at the edge, on the machine that drives the panel. Everything here needs a
model in memory, so none of it belongs in a cloud container: a GPU instance idling
through a showroom's quiet hours costs more than the entire rest of the platform.

Keeping it local also means the conversation survives the network going down,
which is the failure a showroom actually experiences.
"""

from fastapi import APIRouter, Request
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
    products = catalog.search(query, max_price=max_price, org_id=org_id)

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
        for chunk in llm.stream_reply(
            memory.get_history(req.session),
            avatar.persona,
            products,
            req.context,
            documents.as_context(passages),
        ):
            reply += chunk
            yield chunk
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


@router.post("/reset")
def reset(req: ResetRequest | None = None):
    """A visitor walked away. The next one starts a conversation, not a
    continuation — and nobody else's is touched."""
    memory.clear(req.session if req else "default")
    return {"ok": True, "active_sessions": memory.active()}
