"""How an avatar is rendered and how one is created.

The seam that keeps lip-sync vendors replaceable. Today only `mp4` is implemented
— crossfaded clips, no lip-sync, free and offline. The hosted providers are
declared but not wired: each one is a handful of HTTP calls behind this interface,
and adding one must not touch anything outside this file.

Deliberately not stubs that quietly return nothing. An unconfigured provider says
exactly what is missing, because a silent no-op in a rendering path is debugged by
staring at a blank screen.
"""

from dataclasses import dataclass
from typing import Protocol

from backend import config
from backend.store import Avatar


class ProviderUnavailable(RuntimeError):
    """Named so callers can fall back to mp4 rather than failing the session."""


@dataclass
class Session:
    """A live rendering session. `token` is whatever the browser needs to attach —
    a LiveKit token, a WebRTC offer, or nothing at all for local playback."""

    provider: str
    token: str = ""
    url: str = ""


class AvatarProvider(Protocol):
    name: str

    def available(self) -> bool: ...

    def create_from_photo(self, avatar: Avatar, image: bytes) -> str:
        """Returns a provider-side avatar id. Studio calls this on upload."""

    def start_session(self, avatar: Avatar) -> Session: ...

    def stop_session(self, session: Session) -> None: ...


class Mp4Provider:
    """The current renderer. Clips are produced offline by conform_footage.py and
    served as static files, so there is no session to open and nothing to bill."""

    name = "mp4"

    def available(self) -> bool:
        return True

    def create_from_photo(self, avatar: Avatar, image: bytes) -> str:
        raise ProviderUnavailable(
            "mp4 avatars are built by the asset pipeline, not the API. "
            "Run make_poster.py, then conform_footage.py."
        )

    def start_session(self, avatar: Avatar) -> Session:
        return Session(provider=self.name)

    def stop_session(self, session: Session) -> None:
        return None


class HostedProvider:
    """Placeholder for Simli, HeyGen and Anam.

    All three are photo-or-video in, WebRTC session out, and differ mainly in
    price and realism. Whichever is chosen implements the three methods here;
    nothing above this file changes.
    """

    def __init__(self, name: str, api_key: str, docs: str):
        self.name = name
        self._key = api_key
        self._docs = docs

    def available(self) -> bool:
        return bool(self._key)

    def _refuse(self) -> ProviderUnavailable:
        return ProviderUnavailable(
            f"{self.name} is not wired up yet. Set {self.name.upper()}_API_KEY and "
            f"implement backend/avatar_provider.py against {self._docs}."
        )

    def create_from_photo(self, avatar: Avatar, image: bytes) -> str:
        raise self._refuse()

    def start_session(self, avatar: Avatar) -> Session:
        raise self._refuse()

    def stop_session(self, session: Session) -> None:
        return None


_PROVIDERS: dict[str, AvatarProvider] = {
    "mp4": Mp4Provider(),
    "simli": HostedProvider("simli", config.SIMLI_API_KEY, "docs.simli.com"),
    "heygen": HostedProvider("heygen", config.HEYGEN_API_KEY, "docs.heygen.com"),
    "anam": HostedProvider("anam", config.ANAM_API_KEY, "docs.anam.ai"),
}


def for_avatar(avatar: Avatar) -> AvatarProvider:
    """The avatar's own renderer, falling back to mp4 if it is not usable.

    Falling back rather than raising is deliberate: a kiosk whose lip-sync vendor
    is down should keep talking with crossfaded clips, not go blank.
    """
    provider = _PROVIDERS.get(avatar.renderer or "mp4", _PROVIDERS["mp4"])
    return provider if provider.available() else _PROVIDERS["mp4"]


def available() -> list[str]:
    return [name for name, p in _PROVIDERS.items() if p.available()]
