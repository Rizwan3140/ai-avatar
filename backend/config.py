"""Every external service in one place.

Nothing here is required to run. The platform works today on local models and
files; each key below switches one piece from local to hosted. `report()` prints
what is wired and what is not, so a missing key is visible at startup rather than
as a confusing failure mid-conversation.

Copy .env.example to .env and fill in what you have.
"""

import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _load_dotenv() -> None:
    """Read .env without a dependency. Real environment variables always win.

    A bad line is skipped, never raised on. This file is edited by hand, often
    over SSH, sometimes by a shell that writes UTF-16 — `Add-Content` on Windows
    does, which appends a line of null-separated bytes onto a UTF-8 file. That
    took the whole backend down with `ValueError: embedded null character`, from
    a traceback that never mentions `.env`, so the machine simply stopped
    starting for no visible reason. One unreadable setting is not worth a server
    that will not boot.
    """
    env = ROOT / ".env"
    if not env.exists():
        return
    # `replace` rather than strict: a mis-encoded line should arrive as nonsense
    # and be skipped below, not abort the read for every setting after it.
    text = env.read_text(encoding="utf-8", errors="replace").replace(chr(0), "")
    for number, line in enumerate(text.splitlines(), 1):
        line = line.strip().lstrip(chr(0xFEFF))
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        # Anything that is not a plain setting name is a line that got mangled
        # in transit, not a variable somebody meant.
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            print(f"  .env line {number}: ignoring unreadable setting name")
            continue
        os.environ.setdefault(key, value.strip().strip("\"'"))


_load_dotenv()


def _get(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


# --- topology ----------------------------------------------------------------
# edge   the machine driving a panel: conversation, models, footage, kiosk UI
# cloud  the platform: avatars, kiosks, studio. No models, no GPU, no footage.
# all    both in one process — development, and a single-kiosk install
ROLE = _get("LUXORA_ROLE", "all")

# Where an edge machine pulls its avatar configuration from. Blank = standalone,
# reading only what is on its own disk.
PLATFORM_URL = _get("PLATFORM_URL")
SYNC_INTERVAL = int(_get("SYNC_INTERVAL", "300"))
# Which cabinet this machine is. The kiosk UI reads the same value from
# VITE_KIOSK_ID; sync uses it to pull this cabinet's configuration and no other
# tenant's. Must match what was registered in the studio.
KIOSK_ID = _get("KIOSK_ID", "default")

# Load the sample catalog when the database is empty. On by default, because a
# fresh deploy with an empty showroom looks broken. Off for anything that builds
# its own fixtures — a test's data should be the test's, not the sample's.
SEED_SAMPLE = _get("LUXORA_SEED", "1") != "0"

# Comma-separated origins allowed to call this API from a browser. Blank — the
# default — adds no CORS middleware at all, which is correct for a kiosk serving
# its own UI from this same origin. Set it only when the frontend is hosted
# somewhere else, and list the exact origins: a wildcard plus credentials hands
# a studio session to any page that asks.
ALLOWED_ORIGINS = [o for o in _get("ALLOWED_ORIGINS").split(",") if o.strip()]


# --- what runs the conversation ---------------------------------------------
# Local by default. A kiosk that goes mute when the Wi-Fi drops is a worse
# failure than a slower one, so these keep working with nothing configured.

# Which implementation answers, and which one listens.
#
# "auto" is the useful default: local when nothing is configured, hosted the
# moment a key exists. That way a cabinet needs no settings at all and a cloud
# deployment needs exactly one.
#
# The seam is real either way — `llm.stream_reply()` and `stt.transcribe()` are
# the whole contract, and nothing above them knows which of these is running.
LLM_PROVIDER = _get("LLM_PROVIDER", "auto")   # auto | ollama | groq
STT_PROVIDER = _get("STT_PROVIDER", "auto")   # auto | whisper | groq

# Groq is OpenAI-compatible and has a free tier with no card, which makes it the
# one hosted option that can be demonstrated without a purchase order. It has no
# SLA, so it belongs in a cloud demo rather than on a showroom floor — a cabinet
# should keep its models local and survive the network.
GROQ_MODEL = _get("GROQ_MODEL", "llama-3.3-70b-versatile")
GROQ_STT_MODEL = _get("GROQ_STT_MODEL", "whisper-large-v3-turbo")
GROQ_BASE_URL = _get("GROQ_BASE_URL", "https://api.groq.com/openai/v1")

# 127.0.0.1, never "localhost".
#
# On Windows "localhost" resolves to ::1 first. Ollama listens on IPv4 only, so
# the IPv6 attempt is refused and the client waits out a ~2 second fallback
# before trying 127.0.0.1 — on every single request. Measured on this machine:
# localhost 2037ms, 127.0.0.1 3ms, to an endpoint that does no inference at all.
#
# It cost two seconds off the front of every reply and looked exactly like a slow
# model. It is not the model; it is name resolution.
OLLAMA_HOST = _get("OLLAMA_HOST", "http://127.0.0.1:11434")
OLLAMA_MODEL = _get("OLLAMA_MODEL", "llama3.2:3b")
# Measured on a 12-core CPU, int8, for 3.7 seconds of speech:
#
#   tiny.en   443 ms
#   base.en   849 ms
#
# base.en is the default because a misheard question is unrecoverable — it sends
# the wrong words to the model and the whole answer is wrong — whereas latency is
# merely felt. Set WHISPER_MODEL=tiny.en to halve the wait if the room turns out
# to be quiet and the speech clear.
WHISPER_MODEL = _get("WHISPER_MODEL", "base.en")
#: Discard a transcribed segment whose `no_speech_prob` is above this. Whisper
#: invents fluent sentences from silence — "Bye bye", "I will see you in the next
#: video" — and each one reached the model as a visitor's question. Tune per room:
#: lower catches more hallucinations and risks clipping a quiet visitor.
WHISPER_NO_SPEECH = float(_get("WHISPER_NO_SPEECH", "0.6"))

ANTHROPIC_API_KEY = _get("ANTHROPIC_API_KEY")
GROQ_API_KEY = _get("GROQ_API_KEY")          # fast, cheap: intent and routing
DEEPGRAM_API_KEY = _get("DEEPGRAM_API_KEY")  # streaming STT
CARTESIA_API_KEY = _get("CARTESIA_API_KEY")
ELEVENLABS_API_KEY = _get("ELEVENLABS_API_KEY")

# --- avatar rendering --------------------------------------------------------
AVATAR_PROVIDER = _get("AVATAR_PROVIDER", "mp4")  # mp4 | simli | heygen | anam
SIMLI_API_KEY = _get("SIMLI_API_KEY")
HEYGEN_API_KEY = _get("HEYGEN_API_KEY")
ANAM_API_KEY = _get("ANAM_API_KEY")

LIVEKIT_URL = _get("LIVEKIT_URL")
LIVEKIT_API_KEY = _get("LIVEKIT_API_KEY")
LIVEKIT_API_SECRET = _get("LIVEKIT_API_SECRET")

# --- platform ----------------------------------------------------------------
SUPABASE_URL = _get("SUPABASE_URL")
SUPABASE_ANON_KEY = _get("SUPABASE_ANON_KEY")
SUPABASE_SERVICE_ROLE_KEY = _get("SUPABASE_SERVICE_ROLE_KEY")

# --- knowledge ---------------------------------------------------------------
FIRECRAWL_API_KEY = _get("FIRECRAWL_API_KEY")
VOYAGE_API_KEY = _get("VOYAGE_API_KEY")
OPENAI_API_KEY = _get("OPENAI_API_KEY")
# NVIDIA NIM — free tier, OpenAI-compatible, 40 req/min. Worth having for
# embeddings and for A/B-ing a large model against the local one. Not for the
# conversation path: a free tier has no SLA, and the edge/cloud split exists
# precisely to keep the network out of a live conversation.
NVIDIA_API_KEY = _get("NVIDIA_API_KEY")
NVIDIA_BASE_URL = _get("NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1")

# --- generation --------------------------------------------------------------
FAL_KEY = _get("FAL_KEY")                    # try-on, avatar clips
REPLICATE_API_TOKEN = _get("REPLICATE_API_TOKEN")

# --- try-on ------------------------------------------------------------------
# local | replicate | fal. Local keeps a member of the public's photograph inside
# the cabinet, which is the strongest argument for it and is independent of cost.
TRYON_PROVIDER = _get("TRYON_PROVIDER", "local")
# Pinned model versions, overridable: a hash goes stale, and a vendor's 422 then
# reads as our bug rather than as a model that moved.
TRYON_MODEL_REPLICATE = _get(
    "TRYON_MODEL_REPLICATE",
    "c871bb9b046607b680449ecbae55fd8c6d945e0a1948644bf2361b3d021d3ff4",
)
TRYON_MODEL_FAL = _get("TRYON_MODEL_FAL", "fal-ai/idm-vton")

# --- operations --------------------------------------------------------------
LANGFUSE_PUBLIC_KEY = _get("LANGFUSE_PUBLIC_KEY")
LANGFUSE_SECRET_KEY = _get("LANGFUSE_SECRET_KEY")
SENTRY_DSN = _get("SENTRY_DSN")


def using_supabase() -> bool:
    return bool(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)


class ProviderUnreachable(RuntimeError):
    """A hosted model could not be reached, or would not serve us right now.

    Separate from a plain RuntimeError because the two need opposite handling. A
    showroom's wifi dropping, or a rate limit on a busy Saturday, should quietly
    become the local model and a visitor who notices nothing. A rejected key
    should stay loud, because falling back on it would hide a broken deployment
    behind a slower answer nobody ever investigates.

    Here rather than in `llm.py` because `stt.py` needs the same distinction, and
    neither of those should have to import the other to get at it.
    """


#: Statuses worth retrying somewhere else. 429 is the one that will actually
#: happen — the hosted tier is rate-limited per minute and a Saturday is not.
#: Every other 4xx is our own fault and must not be swallowed.
RETRY_STATUS = frozenset({408, 429, 500, 502, 503, 504})


def llm_provider() -> str:
    """Which implementation will actually answer. Resolved once, here, so the
    module that answers and the banner that reports it can never disagree."""
    if LLM_PROVIDER != "auto":
        return LLM_PROVIDER
    return "groq" if GROQ_API_KEY else "ollama"


def stt_provider() -> str:
    if STT_PROVIDER != "auto":
        return STT_PROVIDER
    return "groq" if GROQ_API_KEY else "whisper"


def _chain(provider: str, hosted: str, local: str) -> str:
    """"-> groq-model, else local-model" when a hosted one is answering."""
    return f"-> {hosted}, else {local}" if provider == "groq" else f"-> {local}"


def hosted_models() -> bool:
    """True when conversation can run without a model on this machine — which is
    what lets the cloud role serve `/api/chat` at all."""
    return llm_provider() != "ollama" and stt_provider() != "whisper"


_GROUPS = {
    "conversation": [
        # Name the fallback too. A banner that says only "groq" is a banner that
        # lies the moment the wifi drops, and the whole point of the fallback is
        # that nobody notices it happening.
        ("answers", llm_provider(), _chain(llm_provider(), GROQ_MODEL, OLLAMA_MODEL)),
        ("listens", stt_provider(), _chain(stt_provider(), GROQ_STT_MODEL, WHISPER_MODEL)),
        ("Anthropic", ANTHROPIC_API_KEY, "hosted LLM"),
        ("Groq", GROQ_API_KEY, "hosted LLM + STT"),
        ("Deepgram", DEEPGRAM_API_KEY, "streaming STT"),
        ("Cartesia", CARTESIA_API_KEY, "streaming TTS"),
        ("ElevenLabs", ELEVENLABS_API_KEY, "expressive TTS"),
    ],
    "avatar": [
        ("Provider", AVATAR_PROVIDER, "active renderer"),
        ("Simli", SIMLI_API_KEY, "lip-sync"),
        ("HeyGen", HEYGEN_API_KEY, "lip-sync"),
        ("Anam", ANAM_API_KEY, "lip-sync"),
        ("LiveKit", LIVEKIT_URL, "transport"),
    ],
    "platform": [("Supabase", SUPABASE_URL, "database, auth, storage")],
    "knowledge": [
        ("Firecrawl", FIRECRAWL_API_KEY, "website crawling"),
        ("Voyage", VOYAGE_API_KEY, "embeddings"),
        ("OpenAI", OPENAI_API_KEY, "embeddings"),
        ("NVIDIA", NVIDIA_API_KEY, "free embeddings + eval LLM"),
    ],
    "generation": [
        ("fal.ai", FAL_KEY, "try-on, avatar clips"),
        ("Replicate", REPLICATE_API_TOKEN, "try-on, avatar clips"),
        ("Try-on", TRYON_PROVIDER, "garment swap"),
    ],
    "operations": [
        ("Langfuse", LANGFUSE_PUBLIC_KEY, "LLM tracing"),
        ("Sentry", SENTRY_DSN, "error tracking"),
    ],
}


def report() -> str:
    # ASCII only. A Windows console defaults to cp1252 and raises on anything
    # else, which turns a status line into a crash at startup.
    lines = [f"  role: {ROLE}" + (f" -> {PLATFORM_URL}" if PLATFORM_URL else "")]
    for group, entries in _GROUPS.items():
        lines.append(f"  {group}")
        for name, value, note in entries:
            mark = "on " if value else "-- "
            lines.append(f"    {mark} {name:<12} {note}")
    return "\n".join(lines)
