"""What the showroom looks like this month.

A cabinet stands in a mall through Diwali, a wedding season, a summer range and
an ordinary Tuesday, and it should not look identical on all four. Until now it
did, because the appearance lived in components: every re-skin was a code change,
a rebuild and a visit to the machine.

A season is data instead. It names a date range and a handful of token values,
it is written from the Studio, it syncs to cabinets like avatars and campaigns
already do, and it is read off local disk — so a showroom that loses its network
during Diwali stays dressed for Diwali.

Deliberately the same shape as `campaigns.py`, which already schedules by time of
day. This schedules by date, because a festival is not an hour.

**Only the tokens below can be set, and only to values that parse.** These end up
as CSS custom properties on a screen the public looks at, so the whitelist is a
trust boundary and not tidiness — the browser applies them through
`setProperty`, which cannot break out of a declaration, and this is the second
lock on the same door.
"""

import json
import re
from dataclasses import asdict, dataclass, field
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEASONS_FILE = ROOT / "knowledge" / "seasons.json"

DEFAULT_ORG = "default"

#: What a season may repaint.
#:
#: `canvas` and `ink` are deliberately absent. The panel is transparent and the
#: footage is a dark subject lit against a light field — invert those two and the
#: avatar dissolves into his own background, which is a broken cabinet rather
#: than a festive one. Everything a season actually wants is here: the accent
#: that carries the mood, the rules and secondary text that tint with it, and the
#: face the showroom's name is set in.
THEMEABLE = {
    "--color-accent": "color",
    "--color-ink-soft": "color",
    "--color-line": "color",
    # The ground the page stands on, as two colours the stylesheet composes into
    # a gradient. Two hex values rather than one gradient string: two colour
    # pickers is an interface a person can use, and two hex values are something
    # this file can actually validate. A `linear-gradient(...)` arriving over the
    # network would be a string we could only pattern-match at and hope.
    "--backdrop-from": "color",
    "--backdrop-to": "color",
    "--font-display": "font",
}

_HEX = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
#: A font stack: names, quotes, spaces, commas. No parentheses, no semicolons,
#: no `url(`, nothing that could carry a second declaration or a request.
_FONT = re.compile(r"^[A-Za-z0-9 ,'\"\-]{1,120}$")


def _clean(tokens: dict) -> dict[str, str]:
    """Keep what is allowed and parses. Drop the rest silently — a season with
    one bad colour should still dress the room, not refuse to."""
    out: dict[str, str] = {}
    for name, kind in THEMEABLE.items():
        value = str(tokens.get(name, "")).strip()
        if not value:
            continue
        if kind == "color" and _HEX.match(value):
            out[name] = value
        elif kind == "font" and _FONT.match(value):
            out[name] = value
    return out


@dataclass
class Season:
    id: str
    name: str
    #: Inclusive ISO dates. Blank means "whenever nothing else applies", which is
    #: how the everyday look is expressed rather than as a special case in code.
    starts: str = ""
    ends: str = ""
    tokens: dict[str, str] = field(default_factory=dict)
    org_id: str = DEFAULT_ORG

    def runs_on(self, day: date) -> bool:
        if not self.starts or not self.ends:
            return False  # The fallback is chosen by `active()`, not by matching.
        try:
            return date.fromisoformat(self.starts) <= day <= date.fromisoformat(self.ends)
        except ValueError:
            return False


def _read() -> list[dict]:
    if not SEASONS_FILE.exists():
        return []
    try:
        return json.loads(SEASONS_FILE.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return []


def list_seasons(org_id: str | None = None) -> list[Season]:
    rows = _read()
    seasons = [
        Season(
            id=str(r.get("id", "")),
            name=str(r.get("name", "")),
            starts=str(r.get("starts", "")),
            ends=str(r.get("ends", "")),
            tokens=_clean(r.get("tokens") or {}),
            org_id=str(r.get("org_id", DEFAULT_ORG)),
        )
        for r in rows
        if r.get("id")
    ]
    if org_id is None:
        return seasons
    return [s for s in seasons if s.org_id == org_id]


def save(season: Season) -> Season:
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,48}", season.id):
        raise ValueError(f"unusable season id: {season.id!r}")
    season.tokens = _clean(season.tokens)
    rows = [r for r in _read() if r.get("id") != season.id]
    rows.append(asdict(season))
    SEASONS_FILE.parent.mkdir(parents=True, exist_ok=True)
    SEASONS_FILE.write_text(
        json.dumps(rows, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    return season


def delete(season_id: str, org_id: str) -> bool:
    rows = _read()
    keep = [
        r for r in rows
        if not (r.get("id") == season_id and r.get("org_id", DEFAULT_ORG) == org_id)
    ]
    if len(keep) == len(rows):
        return False
    SEASONS_FILE.write_text(
        json.dumps(keep, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    return True


def active(org_id: str = DEFAULT_ORG, day: date | None = None) -> dict[str, str]:
    """The tokens in force today, or an empty dict for the everyday look.

    A dated season wins over the undated one, and the shortest dated season wins
    over a longer one it sits inside: "Diwali" inside "Festive season" should
    show Diwali for those five days, which is the only sensible reading of
    somebody having created both.
    """
    day = day or date.today()
    mine = list_seasons(org_id)
    running = [s for s in mine if s.runs_on(day)]
    if running:
        return min(running, key=_span).tokens
    fallback = next((s for s in mine if not s.starts and not s.ends), None)
    return fallback.tokens if fallback else {}


def _span(season: Season) -> int:
    try:
        return (date.fromisoformat(season.ends) - date.fromisoformat(season.starts)).days
    except ValueError:
        return 10**6


def demo() -> None:
    """Runnable check: `python -m backend.seasons`."""
    d = date(2026, 10, 22)

    everyday = Season(id="everyday", name="Everyday", tokens={"--color-accent": "#3b82f6"})
    diwali = Season(
        id="diwali", name="Diwali", starts="2026-10-20", ends="2026-10-25",
        tokens={"--color-accent": "#c2410c", "--color-line": "#e7d9c4"},
    )
    festive = Season(
        id="festive", name="Festive season", starts="2026-10-01", ends="2026-11-30",
        tokens={"--color-accent": "#a16207"},
    )

    assert diwali.runs_on(d) and festive.runs_on(d)
    assert not diwali.runs_on(date(2026, 12, 1))
    # Undated seasons never "run"; they are the fallback `active()` reaches for.
    assert not everyday.runs_on(d)
    # The tighter window wins where both apply.
    assert _span(diwali) < _span(festive)

    # Only whitelisted tokens survive, and only if they parse.
    dirty = _clean({
        "--color-accent": "#c2410c",
        "--color-canvas": "#000000",                  # not themeable: would hide him
        "--color-line": "red",                        # not a hex value
        "--font-display": "'Playfair Display', serif",
        "--color-ink-soft": "#fff; } html { display:none",   # injection attempt
    })
    assert dirty == {"--color-accent": "#c2410c", "--font-display": "'Playfair Display', serif"}, dirty

    assert _clean({"--font-display": "url(http://x/f.woff)"}) == {}
    print("seasons: ok")


if __name__ == "__main__":
    demo()
