"""Every external service in one place.

Nothing here is required to run. The platform works today on local models and
files; each key below switches one piece from local to hosted. `report()` prints
what is wired and what is not, so a missing key is visible at startup rather than
as a confusing failure mid-conversation.

Copy .env.example to .env and fill in what you have.
"""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _load_dotenv() -> None:
    """Read .env without a dependency. Real environment variables always win."""
    env = ROOT / ".env"
    if not env.exists():
        return
    for line in env.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


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

# Comma-separated origins allowed to call this API from a browser. Blank — the
# default — adds no CORS middleware at all, which is correct for a kiosk serving
# its own UI from this same origin. Set it only when the frontend is hosted
# somewhere else, and list the exact origins: a wildcard plus credentials hands
# a studio session to any page that asks.
ALLOWED_ORIGINS = [o for o in _get("ALLOWED_ORIGINS").split(",") if o.strip()]


# --- what runs the conversation ---------------------------------------------
# Local by default. A kiosk that goes mute when the Wi-Fi drops is a worse
# failure than a slower one, so these keep working with nothing configured.

OLLAMA_HOST = _get("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_MODEL = _get("OLLAMA_MODEL", "llama3.2:3b")
WHISPER_MODEL = _get("WHISPER_MODEL", "base.en")

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


_GROUPS = {
    "conversation": [
        ("Ollama", OLLAMA_HOST, f"local, {OLLAMA_MODEL}"),
        ("Whisper", WHISPER_MODEL, "local"),
        ("Anthropic", ANTHROPIC_API_KEY, "hosted LLM"),
        ("Groq", GROQ_API_KEY, "intent + routing"),
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
