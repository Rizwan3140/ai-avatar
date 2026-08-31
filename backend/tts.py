"""The voice, in his own voice.

The third seam, and deliberately the same shape as `llm.py` and `stt.py`:
`speak(text, avatar) -> bytes` is the whole contract, and nothing above it knows
which implementation answered.

Until now a cabinet spoke with whatever voices macOS happened to ship. That is a
stock voice on a shop window — every install sounding like every other install,
and none of them sounding like the person on the panel. A voice is now a property
of the avatar, cloned from a recording the customer supplies.

**Chatterbox, local.** MIT licensed, so shipping it inside a bundle is fine, and
it clones zero-shot from about ten seconds of reference audio — no training run,
no per-voice setup. It runs on Metal, which is the reason the whole application
is a Mac app rather than a container.

**Browser speech is the floor and stays.** A cabinet with no reference recording,
or on a machine where the model will not load, still talks. Silence is the one
outcome worth avoiding.

**torch is imported inside the function that needs it, never at module level** —
the same rule `stt.py` follows for faster-whisper, and for the same reason: the
cloud image must never carry a gigabyte of model runtime it will not execute.
"""

import threading

from backend import config, store

#: How much reference audio is worth having. Chatterbox needs about ten seconds;
#: more is better and stops mattering fairly quickly. Recorded once, in a quiet
#: room, by whoever the avatar should sound like.
REFERENCE_NAME = "voice.wav"

#: One model, one generation at a time — the same constraint `stt.py` documents.
#: A second visitor's sentence must wait rather than corrupt the first.
#: ponytail: a global lock. Split it the day two cabinets share one process,
#: which is not a thing that happens.
_generation = threading.Lock()

_model = None
_model_lock = threading.Lock()


class VoiceUnavailable(RuntimeError):
    """No local voice model, or no reference recording for this avatar.

    Raised rather than returning empty audio. A silent cabinet is debugged by
    staring at a person who will not speak; an exception says which of the two
    things is missing.
    """


def reference_for(avatar_id: str):
    """The recording this avatar is cloned from, if one has been uploaded.

    Lives beside the footage, because it is the same kind of thing: content that
    belongs to one avatar and travels with it.
    """
    path = store.AVATARS_DIR / avatar_id / REFERENCE_NAME
    return path if path.is_file() else None


def _load():
    """The model, once. Loading costs seconds and must not happen mid-sentence."""
    global _model
    with _model_lock:
        if _model is None:
            # Imported here, not at module scope. See the note at the top.
            from chatterbox.tts import ChatterboxTTS

            _model = ChatterboxTTS.from_pretrained(device=_device())
        return _model


def _device() -> str:
    """Metal where it exists, CPU where it does not.

    Not a preference — on an M4 Pro this is the difference between a voice that
    keeps up with a conversation and one that does not.
    """
    try:
        import torch

        if torch.backends.mps.is_available():
            return "mps"
        if torch.cuda.is_available():
            return "cuda"
    except Exception:
        pass
    return "cpu"


def installed() -> bool:
    """Whether the local voice model could load at all. Cheap: no import of the
    package itself, so asking this in the cloud role costs nothing."""
    import importlib.util

    return importlib.util.find_spec("chatterbox") is not None


def available(avatar_id: str = "") -> bool:
    """Whether *this* avatar can speak in its own voice.

    Two conditions and they fail differently: the model may be absent because
    this is the cloud role, and the recording may be absent because nobody has
    made one yet. `status()` reports which.
    """
    if config.ROLE == "cloud" or not installed():
        return False
    return avatar_id != "" and reference_for(avatar_id) is not None


def status(avatar_id: str = "") -> dict:
    """What the browser needs in order to decide who speaks.

    The cabinet asks this once at boot: with a cloned voice it streams audio from
    here, without one it uses the browser's own synthesiser. Answering honestly
    matters more than answering yes — a cabinet that tries a voice that is not
    there is a cabinet that says nothing.
    """
    return {
        "available": available(avatar_id),
        "provider": "chatterbox" if installed() else "browser",
        "model_installed": installed(),
        "has_reference": avatar_id != "" and reference_for(avatar_id) is not None,
        "device": _device() if installed() else "",
    }


def warm() -> None:
    """Load before the first visitor, not during their first sentence.

    Nothing to warm without a model or without any avatar having a recording —
    and touching `_load()` in the cloud role would import torch into a container
    that does not have it.
    """
    if config.ROLE == "cloud" or not installed():
        return
    if not any(reference_for(a.id) for a in store.list_avatars()):
        return
    threading.Thread(target=_load, daemon=True).start()


def speak(text: str, avatar_id: str) -> bytes:
    """One sentence, as WAV bytes, in this avatar's cloned voice.

    A sentence rather than a whole reply on purpose. The browser already speaks
    each sentence as it arrives from the model, which is what puts the first word
    under a second; generating a whole answer before any of it is heard would
    trade that away for a tidier request.
    """
    text = (text or "").strip()
    if not text:
        raise ValueError("nothing to say")

    reference = reference_for(avatar_id)
    if reference is None:
        raise VoiceUnavailable(
            f"no voice recording for {avatar_id!r} — upload one in the Studio, "
            f"about thirty seconds of clear speech"
        )
    if not installed():
        raise VoiceUnavailable(
            "the local voice model is not installed on this machine "
            "(pip install chatterbox-tts)"
        )

    import io

    import torchaudio

    model = _load()
    with _generation:
        wav = model.generate(text, audio_prompt_path=str(reference))

    buffer = io.BytesIO()
    torchaudio.save(buffer, wav, model.sr, format="wav")
    return buffer.getvalue()


def demo() -> None:
    """Runnable check: `python -m backend.tts`.

    Exercises the seam, not the model — which is the part that has to be right
    whether or not a machine can load torch, and the part a test can hold.
    """
    assert isinstance(installed(), bool)

    s = status("")
    assert s["available"] is False, "no avatar named, so nothing to speak with"
    assert s["provider"] in ("chatterbox", "browser")
    assert set(s) == {"available", "provider", "model_installed", "has_reference", "device"}

    # An avatar with no recording cannot speak, and says which thing is missing.
    try:
        speak("hello", "definitely-not-an-avatar")
        raise AssertionError("should have refused")
    except VoiceUnavailable as error:
        assert "no voice recording" in str(error)

    # Empty text is a caller's bug, not a missing voice.
    try:
        speak("   ", "anything")
        raise AssertionError("should have refused")
    except ValueError:
        pass

    assert reference_for("definitely-not-an-avatar") is None
    assert _device() in ("mps", "cuda", "cpu")
    print("tts: ok")


if __name__ == "__main__":
    demo()
