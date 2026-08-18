"""Local speech-to-text.

Runs entirely on this machine. A kiosk that loses its network should go quiet,
not deaf — and the browser's own recogniser is a Google cloud service that is
unavailable in every Chromium build without Google's private API key.
"""

import os
import threading

from faster_whisper import WhisperModel

# Measured on a 12-core CPU, int8, for 3.7 seconds of speech:
#
#   tiny.en   443 ms
#   base.en   849 ms
#
# base.en is the default because a misheard question is unrecoverable — it sends
# the wrong words to the model and the whole answer is wrong — whereas latency is
# merely felt. Set WHISPER_MODEL=tiny.en to halve the wait if the room turns out
# to be quiet and the speech clear.
MODEL_SIZE = os.getenv("WHISPER_MODEL", "base.en")

_model: WhisperModel | None = None
_lock = threading.Lock()

#: One model, one inference at a time. A final pass overlaps an in-flight
#: partial — `finishTurn()` in the browser does not wait for the partial it just
#: started — and FastAPI runs sync handlers on a threadpool, so both land in
#: `transcribe()` on different threads sharing one CTranslate2 model, which is
#: not safe for concurrent use.
#: ponytail: one global lock; a second model instance if a partial waiting on a
#: final ever becomes the latency that matters.
_inference = threading.Lock()


def _get_model() -> WhisperModel:
    global _model
    with _lock:
        if _model is None:
            _model = WhisperModel(MODEL_SIZE, device="cpu", compute_type="int8")
        return _model


def warm() -> None:
    """Load the model before the first visitor does, not during their sentence."""
    threading.Thread(target=_get_model, daemon=True).start()


def transcribe(audio: bytes, partial: bool = False) -> str:
    """Audio bytes in, text out. Accepts anything PyAV can decode, WAV included."""
    import io

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
        return " ".join(segment.text.strip() for segment in segments).strip()
