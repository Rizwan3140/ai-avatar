"""Sarvam AI — hearing and speaking Indian languages.

Whisper can be told a visitor speaks Telugu and still write down something else:
Telugu is thin in its training data, and a showroom sentence is half English
anyway — "ee palazzo pant price entandi". Browser speech is worse on the way
out: a Windows machine ships no Telugu voice at all, and Chatterbox clones
English. Sarvam is trained on exactly this speech, so an avatar whose language
is an Indian one hears and speaks through here, and English avatars never touch
it.

Both calls sit in one file because they share a key, a host and a failure
policy, and neither `stt.py` nor `tts.py` should know what a Sarvam request
looks like. Stdlib `urllib`, like every other outbound call in this project.

**Hosted, with the existing paths underneath.** A dropped network raises
`ProviderUnreachable` and the caller falls back — Whisper for hearing, the
browser for speaking. A rejected key stays a loud `RuntimeError`, for the reason
`config.ProviderUnreachable` gives.
"""

import base64
import json
import os
import urllib.error
import urllib.request

from backend import config

#: What Sarvam will transcribe, as the avatar stores it.
HEARS = frozenset({
    "hi-IN", "bn-IN", "kn-IN", "ml-IN", "mr-IN", "od-IN", "pa-IN",
    "ta-IN", "te-IN", "gu-IN", "ur-IN",
})

#: What it will speak. Narrower than what it hears: no Urdu voice.
SPEAKS = frozenset({
    "hi-IN", "bn-IN", "kn-IN", "ml-IN", "mr-IN", "od-IN", "pa-IN",
    "ta-IN", "te-IN", "gu-IN",
})

#: bulbul:v3 voices are not tied to a language — any of them speaks all of
#: `SPEAKS` — so the choice follows the avatar's gender, the same way the
#: browser voice picker does. An avatar whose `voice` names one of these keeps it.
VOICES = frozenset({
    "shubh", "aditya", "ritu", "priya", "neha", "rahul", "pooja", "rohan",
    "simran", "kavya", "amit", "dev", "ishita", "shreya", "ratan", "varun",
    "manan", "sumit", "roopa", "kabir", "aayan", "ashutosh", "advait", "anand",
    "tanya", "tarun", "sunny", "mani", "gokul", "vijay", "shruti", "suhani",
    "mohit", "kavitha", "rehan", "soham", "rupali",
})
DEFAULT_VOICE = {"male": "vijay", "female": "shruti"}


def hears(language: str) -> bool:
    return bool(config.SARVAM_API_KEY) and language in HEARS


def speaks(language: str) -> bool:
    return bool(config.SARVAM_API_KEY) and language in SPEAKS


def voice_for(gender: str, voice: str = "") -> str:
    if voice in VOICES:
        return voice
    return DEFAULT_VOICE.get(gender, DEFAULT_VOICE["female"])


def _post(path: str, body: bytes, content_type: str) -> dict:
    request = urllib.request.Request(
        f"{config.SARVAM_BASE_URL}{path}",
        data=body,
        headers={
            "Content-Type": content_type,
            "api-subscription-key": config.SARVAM_API_KEY,
            "User-Agent": "Luxora/1.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")[:200]
        message = f"Sarvam refused {path} ({error.code}): {detail}"
        if error.code in config.RETRY_STATUS:
            raise config.ProviderUnreachable(message) from error
        raise RuntimeError(message) from error
    except (urllib.error.URLError, TimeoutError) as error:
        raise config.ProviderUnreachable(f"Cannot reach Sarvam. ({error})") from error


def transcribe(audio: bytes, language: str) -> str:
    """One visitor turn, as text.

    `codemix` keeps English words in Latin script and the rest in the visitor's
    own. That is what lets an English catalog be searched from a Telugu
    sentence: `catalog.search` reads `[a-z]+` words only, so "palazzo pant"
    matches and the Telugu around it is not mistaken for a search term.
    """
    crlf = "\r\n"
    boundary = "----luxora" + os.urandom(8).hex()
    head = ""
    for name, value in (
        ("model", config.SARVAM_STT_MODEL),
        ("mode", "codemix"),
        ("language_code", language),
    ):
        head += f"--{boundary}{crlf}"
        head += f'Content-Disposition: form-data; name="{name}"{crlf}{crlf}{value}{crlf}'
    head += f"--{boundary}{crlf}"
    head += f'Content-Disposition: form-data; name="file"; filename="turn.wav"{crlf}'
    head += f"Content-Type: audio/wav{crlf}{crlf}"
    body = head.encode() + audio + f"{crlf}--{boundary}--{crlf}".encode()

    data = _post("/speech-to-text", body, f"multipart/form-data; boundary={boundary}")
    return str(data.get("transcript", "")).strip()


def speak(text: str, language: str, voice: str) -> bytes:
    """One sentence, as WAV bytes."""
    payload = {
        "text": text,
        "language_code": language,
        "model": config.SARVAM_TTS_MODEL,
        "speaker": voice,
        "speech_sample_rate": 24000,
        "output_audio_codec": "wav",
    }
    data = _post("/text-to-speech", json.dumps(payload).encode(), "application/json")
    audios = data.get("audios") or []
    if not audios:
        raise RuntimeError("Sarvam returned no audio")
    return base64.b64decode(audios[0])


def demo() -> None:
    """Runnable check: `python -m backend.sarvam`. The requests, not the service."""
    sent: list[urllib.request.Request] = []
    replies: list[object] = []

    class _Response:
        def __init__(self, body: bytes):
            self.body = body

        def read(self):
            return self.body

        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

    def fake_urlopen(request, timeout=None):
        sent.append(request)
        reply = replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return _Response(json.dumps(reply).encode())

    real_urlopen, real_key = urllib.request.urlopen, config.SARVAM_API_KEY
    urllib.request.urlopen = fake_urlopen
    try:
        config.SARVAM_API_KEY = ""
        assert not hears("te-IN") and not speaks("te-IN"), "no key, no Sarvam"

        config.SARVAM_API_KEY = "test-key"
        assert hears("te-IN") and speaks("te-IN")
        assert not hears("en-US") and not speaks("en-US"), "English stays where it was"
        assert hears("ur-IN") and not speaks("ur-IN"), "no Urdu voice"

        assert voice_for("male") == "vijay" and voice_for("female") == "shruti"
        assert voice_for("") == "shruti"
        assert voice_for("male", "kavitha") == "kavitha", "a named Sarvam voice is kept"
        assert voice_for("male", "Microsoft David - English (United States)") == "vijay"

        replies.append({"transcript": " ఈ palazzo pant ధర ఎంత ", "language_code": "te-IN"})
        assert transcribe(b"RIFF-audio", "te-IN") == "ఈ palazzo pant ధర ఎంత"
        request = sent[-1]
        assert request.full_url.endswith("/speech-to-text")
        assert request.get_header("Api-subscription-key") == "test-key"
        body = request.data
        assert b'name="language_code"\r\n\r\nte-IN' in body
        assert b'name="mode"\r\n\r\ncodemix' in body
        assert b"RIFF-audio" in body

        wav = b"RIFF....WAVE"
        replies.append({"audios": [base64.b64encode(wav).decode()]})
        assert speak("నమస్కారం", "te-IN", "vijay") == wav
        payload = json.loads(sent[-1].data)
        assert payload["language_code"] == "te-IN" and payload["speaker"] == "vijay"
        assert payload["text"] == "నమస్కారం"

        replies.append({"audios": []})
        try:
            speak("x", "te-IN", "vijay")
            raise AssertionError("empty audio should not pass as speech")
        except RuntimeError:
            pass

        # A busy service falls back; a rejected key does not.
        for status, kind in ((429, config.ProviderUnreachable), (503, config.ProviderUnreachable)):
            replies.append(urllib.error.HTTPError("u", status, "busy", {}, None))
            try:
                transcribe(b"a", "te-IN")
                raise AssertionError(f"{status} should raise")
            except kind:
                pass
        replies.append(urllib.error.HTTPError("u", 403, "bad key", {}, None))
        try:
            transcribe(b"a", "te-IN")
            raise AssertionError("403 should raise")
        except config.ProviderUnreachable:
            raise AssertionError("a rejected key must not look like a network blip")
        except RuntimeError:
            pass
        replies.append(urllib.error.URLError("no route to host"))
        try:
            speak("x", "te-IN", "vijay")
            raise AssertionError("offline should raise")
        except config.ProviderUnreachable:
            pass
    finally:
        urllib.request.urlopen, config.SARVAM_API_KEY = real_urlopen, real_key

    print("sarvam: ok")


if __name__ == "__main__":
    demo()
