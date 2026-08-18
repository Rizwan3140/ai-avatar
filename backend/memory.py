"""Conversation history, per visitor.

One dict of sessions rather than one global list. A single list was correct while
there was one cabinet; the moment a second kiosk shares a backend it means two
strangers hold one conversation — visitor A's questions become visitor B's
context, and either one walking away wipes the other's history mid-sentence.

Sessions are held in memory and evicted, not persisted. What a member of the
public said to a showroom screen is not something to keep on disk after they have
left, and there is nothing here worth surviving a restart.
"""

import threading
import time

#: A kiosk runs for months. Uncapped history is a slow leak and an ever-growing
#: prompt bill, so old turns fall off the front of each conversation.
MAX_TURNS = 40

#: A visitor who walks off without ending the session leaves it behind. Drop it
#: rather than letting the next person inherit their conversation.
SESSION_TTL = 15 * 60

#: Ceiling on concurrent sessions, so a misbehaving client cannot grow this
#: without bound.
MAX_SESSIONS = 200

_sessions: dict[str, list[dict]] = {}
_touched: dict[str, float] = {}
_lock = threading.Lock()


def _evict(now: float) -> None:
    """Called under the lock."""
    stale = [key for key, at in _touched.items() if now - at > SESSION_TTL]
    for key in stale:
        _sessions.pop(key, None)
        _touched.pop(key, None)

    # Still too many: drop the least recently used.
    while len(_sessions) > MAX_SESSIONS:
        oldest = min(_touched, key=_touched.get)
        _sessions.pop(oldest, None)
        _touched.pop(oldest, None)


def add_message(session: str, role: str, content: str) -> None:
    now = time.monotonic()
    with _lock:
        _evict(now)
        history = _sessions.setdefault(session, [])
        history.append({"role": role, "content": content})
        del history[:-MAX_TURNS]
        _touched[session] = now


def get_history(session: str) -> list[dict]:
    with _lock:
        return list(_sessions.get(session, []))


def clear(session: str) -> None:
    """One visitor walked away. Nobody else's conversation is affected."""
    with _lock:
        _sessions.pop(session, None)
        _touched.pop(session, None)


def active() -> int:
    with _lock:
        return len(_sessions)
