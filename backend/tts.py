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

import io
import threading
import wave

from backend import config, store

#: How much reference audio is worth having. Chatterbox needs about ten seconds;
#: more is better and stops mattering fairly quickly. Recorded once, in a quiet
#: room, by whoever the avatar should sound like.
REFERENCE_NAME = "voice.wav"

#: What the reference is stored as, whatever it arrived as. Chatterbox wants
#: 24 kHz; anything else is resampled on every load for no reason.
SAMPLE_RATE = 24000

#: Longer references stop helping well before this. The cap is really about not
#: turning a 25 MB upload into a 70 MB file on a cabinet's disk.
MAX_REFERENCE_SECONDS = 60


def to_reference_wav(audio: bytes) -> bytes:
    """Whatever the customer exported, as the one format the model reads.

    People have MP3s. They record on a phone, they are sent a voice note, they
    download a clip — and telling them to go and convert it is how a feature
    goes unused. PyAV is already here (faster-whisper brings it) and already
    carries its own ffmpeg, so every common format decodes with no new
    dependency and no shelling out.

    This doubles as the validation. A header check only proves the first four
    bytes look right; actually decoding the file is the only way to know the
    model will not be handed something it cannot read, and it is the same work
    either way.
    """
    import av
    from av.audio.resampler import AudioResampler

    limit = MAX_REFERENCE_SECONDS * SAMPLE_RATE
    frames: list[bytes] = []
    samples = 0
    try:
        with av.open(io.BytesIO(audio)) as container:
            stream = next((s for s in container.streams if s.type == "audio"), None)
            if stream is None:
                raise ValueError("there is no audio in that file")
            resampler = AudioResampler(format="s16", layout="mono", rate=SAMPLE_RATE)
            for frame in container.decode(stream):
                for out in resampler.resample(frame):
                    chunk = out.to_ndarray().tobytes()
                    frames.append(chunk)
                    samples += len(chunk) // 2
                if samples >= limit:
                    break
    except ValueError:
        raise
    except Exception as exc:  # av raises its own hierarchy; the caller wants one
        raise ValueError("that file could not be read as audio") from exc

    if not samples:
        raise ValueError("that file could not be read as audio")

    body = b"".join(frames)[: limit * 2]
    out = io.BytesIO()
    with wave.open(out, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(SAMPLE_RATE)
        wav.writeframes(body)
    return out.getvalue()


def reference_seconds(wav: bytes) -> float:
    """How long the stored recording is, for telling somebody they recorded
    four seconds when the model wanted thirty."""
    with wave.open(io.BytesIO(wav), "rb") as f:
        return round(f.getnframes() / f.getframerate(), 1)


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

    # A real MP3, encoded here rather than committed, because the whole point of
    # this path is that a customer's phone recording works without conversion.
    import av

    raw = io.BytesIO()
    with av.open(raw, "w", format="mp3") as out:
        stream = out.add_stream("mp3", rate=44100)
        source = av.AudioFrame(format="s16", layout="mono", samples=44100)
        source.rate = 44100
        source.planes[0].update(bytes([0, 1]) * 44100)
        for packet in stream.encode(source):
            out.mux(packet)
        for packet in stream.encode(None):
            out.mux(packet)
    mp3 = raw.getvalue()

    wav = to_reference_wav(mp3)
    assert wav[:4] == b"RIFF" and wav[8:12] == b"WAVE", "mp3 did not become a wav"
    assert 0.8 < reference_seconds(wav) < 1.3, reference_seconds(wav)

    # And a WAV still works — converting one is the same code path.
    assert to_reference_wav(wav)[:4] == b"RIFF"

    # Anything unreadable is a 400 for the caller, not a traceback.
    for junk in (b"", b"not audio at all", b"RIFF" + bytes(40)):
        try:
            to_reference_wav(junk)
            raise AssertionError("should have refused " + repr(junk[:8]))
        except ValueError:
            pass

    print("tts: ok")


if __name__ == "__main__":
    demo()
