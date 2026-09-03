"""Speech-to-text, local by default.

A kiosk that loses its network should go quiet, not deaf — and the browser's own
recogniser is a Google cloud service unavailable in every Chromium build without
Google's private API key. So faster-whisper runs on the machine driving the panel.

There is a hosted branch as well, for the cloud role, where there is no model and
no GPU. `transcribe(audio, partial) -> str` is the whole contract either way.

**faster-whisper is imported inside the function that needs it, never at module
level.** That import is what decides whether the cloud container carries a few
hundred megabytes of model runtime it will never execute, and it is the reason
`/api/chat` can exist in a role that has no local model at all.
"""

import json
import os
import threading
import urllib.error
import urllib.request

from backend import analytics, config

_model = None  # WhisperModel, once something asks for it
_lock = threading.Lock()

#: One model, one inference at a time. A final pass overlaps an in-flight
#: partial — `finishTurn()` in the browser does not wait for the partial it just
#: started — and FastAPI runs sync handlers on a threadpool, so both land in
#: `transcribe()` on different threads sharing one CTranslate2 model, which is
#: not safe for concurrent use.
#: ponytail: one global lock; a second model instance if a partial waiting on a
#: final ever becomes the latency that matters.
_inference = threading.Lock()

def _get_model():
    # Imported here, not at module scope. See the note at the top of this file.
    from faster_whisper import WhisperModel

    global _model
    with _lock:
        if _model is None:
            _model = WhisperModel(config.WHISPER_MODEL, device="cpu", compute_type="int8")
        return _model


def warm() -> None:
    """Load the model before the first visitor does, not during their sentence.

    Nothing to warm when a hosted service is listening — and touching
    `_get_model()` would import faster-whisper into a container that does not
    have it.
    """
    if config.stt_provider() != "whisper":
        return
    threading.Thread(target=_get_model, daemon=True).start()


def _multipart(audio: bytes, model: str) -> tuple[bytes, str]:
    """Build a multipart body by hand.

    `requests` would make this three lines, and `python-multipart` is for
    *receiving* rather than sending. Neither earns a dependency for one upload —
    the same reasoning that keeps `/api/listen` on raw bytes.
    """
    crlf = "\r\n"
    boundary = "----luxora" + os.urandom(8).hex()

    head = ""
    for name, value in (("model", model), ("response_format", "text")):
        head += f"--{boundary}{crlf}"
        head += f'Content-Disposition: form-data; name="{name}"{crlf}{crlf}'
        head += f"{value}{crlf}"
    head += f"--{boundary}{crlf}"
    head += f'Content-Disposition: form-data; name="file"; filename="turn.wav"{crlf}'
    head += f"Content-Type: audio/wav{crlf}{crlf}"

    body = head.encode() + audio + f"{crlf}--{boundary}--{crlf}".encode()
    return body, f"multipart/form-data; boundary={boundary}"


def _transcribe_groq(audio: bytes) -> str:
    """Whisper, someone else's machine. Same contract, no local model."""
    body, content_type = _multipart(audio, config.GROQ_STT_MODEL)
    request = urllib.request.Request(
        f"{config.GROQ_BASE_URL}/audio/transcriptions",
        data=body,
        headers={
            "Content-Type": content_type,
            "Authorization": f"Bearer {config.GROQ_API_KEY}",
            # Cloudflare fronts this API and bans the default urllib
            # signature with its own 1010, which reads exactly like a
            # rejected key. Any real name gets through.
            "User-Agent": "Luxora/1.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            text = response.read().decode("utf-8", "replace").strip()
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")[:200]
        message = f"Groq could not transcribe that ({error.code}): {detail}"
        if error.code in config.RETRY_STATUS:
            raise config.ProviderUnreachable(message) from error
        raise RuntimeError(message) from error
    except urllib.error.URLError as error:
        raise config.ProviderUnreachable(
            f"Cannot reach Groq for transcription. ({error})"
        ) from error

    # response_format=text returns a bare string, but a JSON body comes back on
    # some paths. Accept either rather than guessing.
    if text.startswith("{"):
        try:
            return str(json.loads(text).get("text", "")).strip()
        except ValueError:
            return ""
    return text


def ready() -> bool:
    """Whether a transcription would answer now or block on a model load.

    Loading faster-whisper takes about eleven seconds. `warm()` starts it at
    boot, but nothing waited for it — so a visitor who spoke in that window sat
    through the load, and the kiosk had already told them it was ready.
    """
    if config.stt_provider() != "whisper":
        return True  # Nothing to load; the network is the only cost.
    return _model is not None


#: What Whisper says when nobody said anything.
#:
#: It was trained on captioned video, so quiet audio comes back as the caption
#: that usually ends one. These are real lines from this cabinet's own logs,
#: each delivered to the model as a visitor's question and answered out loud to
#: an empty room.
#:
#: The local path already dropped these by `no_speech_prob`. The hosted one had
#: no such filter and is the provider actually in use, so the guard belonged
#: where every provider's answer passes rather than inside one of them.
_NOT_SPEECH = {
    "thank you", "thanks", "thank you.", "thanks for watching",
    "thanks for watching!", "thank you for watching", "bye", "bye bye",
    "bye.", "goodbye", "you", "so", "uh", "um", ".", "..", "...",
    "i'll see you in the next video", "see you in the next video",
    "please subscribe", "subscribe", "okay", "ok", "oh", "hmm", "mm",
    "[music]", "[silence]", "[blank_audio]", "(music)", "music",
}


def is_speech(text: str) -> bool:
    """Whether a transcript is worth waking the model for.

    A cabinet that answers its own silence is worse than one that mishears: it
    talks to nobody, in a shop, at volume, and every passer-by learns the screen
    is broken before they have said a word to it.
    """
    cleaned = text.strip().strip("!?.,\"'").lower()
    if len(cleaned) < 2:
        return False
    return cleaned not in _NOT_SPEECH


def transcribe(audio: bytes, partial: bool = False) -> str:
    """Audio bytes in, text out. Accepts anything PyAV can decode, WAV included."""
    heard = _transcribe(audio, partial)
    return heard if is_speech(heard) else ""


def _transcribe(audio: bytes, partial: bool = False) -> str:
    import io

    # Hosted first, local underneath — the same arrangement `llm.py` uses, and
    # for the same reason: every cabinet should hear alike, and none of them
    # should go deaf because a mall's wifi blinked. A rejected key still raises.
    if config.stt_provider() == "groq":
        try:
            return _transcribe_groq(audio)
        except config.ProviderUnreachable as error:
            print(f"  stt: {error} -- falling back to {config.WHISPER_MODEL}")
            analytics.record("provider_fallback", module="stt", reason=str(error)[:200])

    model = _get_model()

    # A partial is only ever displayed, so it buys latency with a greedy search
    # and no timestamps. The final pass is what the model answers, so it gets the
    # beam search and the silence trimming.
    with _inference:
        segments, _ = model.transcribe(
            io.BytesIO(audio),
            beam_size=1 if partial else 5,
            without_timestamps=partial,
            vad_filter=not partial,
            condition_on_previous_text=False,
        )
        # `transcribe` returns a lazy generator — the work happens on
        # consumption, not on the call, so the join has to be inside the lock or
        # the lock guards nothing.
        #
        # Drop segments the model itself does not believe are speech. Whisper
        # hallucinates fluent sentences from near-silence — its training data was
        # captioned video, so quiet audio comes back as "Thank you for watching",
        # "Bye bye", "I will see you in the next video". Real examples, from this
        # cabinet's own logs, each one delivered to the model as a visitor's
        # question. `no_speech_prob` is exactly this judgement and was being
        # thrown away one attribute short of the text we kept.
        return " ".join(
            segment.text.strip()
            for segment in segments
            if segment.no_speech_prob < config.WHISPER_NO_SPEECH
        ).strip()
