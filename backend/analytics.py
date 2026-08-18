"""What visitors actually did.

Added early on purpose. Instrumentation is the one thing that cannot be
retrofitted — a dashboard built in six months can only report on sessions that
were being recorded at the time, and every conversation before that is gone.

Append-only JSONL, one line per event, rotated by day. No database, no analytics
vendor, no cookie. It is a few kilobytes a day and it aggregates in a second.

Nothing here identifies a person. A showroom kiosk is used by members of the
public who never agreed to anything, so what is stored is what was asked and what
was shown — never who asked it, and never the audio.
"""

import json
import threading
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EVENTS_DIR = ROOT / "knowledge" / "events"

_lock = threading.Lock()


def record(event: str, **fields) -> None:
    """Never raises and never blocks a conversation. A dropped metric is a
    rounding error; a failed reply is a visitor standing in front of a broken
    screen."""
    try:
        EVENTS_DIR.mkdir(parents=True, exist_ok=True)
        now = datetime.now(timezone.utc)
        line = json.dumps({"at": now.isoformat(timespec="seconds"), "event": event, **fields})
        with _lock:
            # Context manager, not a bare .open().write() — that leaves the handle
            # to the garbage collector, and a kiosk running for months should not
            # depend on refcounting to flush what it recorded.
            with (EVENTS_DIR / f"{now:%Y-%m-%d}.jsonl").open("a", encoding="utf-8") as f:
                f.write(line + "\n")
    except Exception:
        pass


def _read(days: int) -> list[dict]:
    if not EVENTS_DIR.is_dir():
        return []
    events = []
    for path in sorted(EVENTS_DIR.glob("*.jsonl"))[-days:]:
        for line in path.read_text(encoding="utf-8").splitlines():
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                continue  # A half-written final line after a power cut.
    return events


def summary(days: int = 30, org_id: str | None = None) -> dict:
    """The questions a showroom manager actually asks.

    `org_id` filters to one company. Events written before tenancy carry no org
    and are counted as the default org's, which is where their data went — losing
    a customer's history to a schema change would be worse than a slightly fuzzy
    boundary on rows that predate the boundary existing.
    """
    events = _read(days)
    if org_id is not None:
        events = [e for e in events if e.get("org", "default") == org_id]

    asked = [e for e in events if e["event"] == "question"]
    shown = [e for e in events if e["event"] == "product_shown"]
    viewed = [e for e in events if e["event"] == "product_viewed"]
    tried = [e for e in events if e["event"] == "tryon"]

    # Questions that returned nothing are the most valuable number here: it is a
    # list of things customers want and the company does not stock.
    unanswered = [e["text"] for e in asked if not e.get("results")]

    # Distinct sessions, not distinct avatars. Before sessions existed this
    # counted the number of avatars and reported it as conversations, which on a
    # single-avatar kiosk is permanently "1".
    return {
        "days": days,
        "conversations": len({e.get("session") for e in events if e.get("session")}),
        "questions": len(asked),
        "unanswered": len(unanswered),
        # How often the company's own documents were the thing that answered.
        # A number near zero means the knowledge base is not earning its upload.
        "answered_from_documents": sum(1 for e in asked if e.get("passages")),
        "tryons": len(tried),
        "top_questions": Counter(e["text"].lower() for e in asked).most_common(10),
        "top_products_shown": Counter(e["product"] for e in shown).most_common(10),
        "top_products_viewed": Counter(e["product"] for e in viewed).most_common(10),
        "top_products_tried": Counter(e["product"] for e in tried).most_common(10),
        "gaps": Counter(t.lower() for t in unanswered).most_common(10),
    }
