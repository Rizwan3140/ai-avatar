"""Company knowledge that is not a product.

A catalog answers "how much is the Titan Pro". It cannot answer "what is your
returns policy", "do you deliver to Pune", or "is there a warranty on this" —
and those are a large share of what a visitor actually asks a showroom
representative.

So: passages of a company's own text, chunked, indexed with the same FTS5 that
already serves the catalog, and retrieved alongside products so the model has the
company's own words in front of it rather than a plausible invention.

Deliberately not embeddings. The corpus is a policy page, a spec sheet and a
brochure — tens of kilobytes, not a library. Keyword search over that is not the
weak link; the model is. Embeddings go behind `search()` on the day retrieval
measurably misses, which is a day that can be identified from the event log.
"""

import re
import sqlite3
from dataclasses import asdict, dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "knowledge" / "catalog.db"

DEFAULT_ORG = "default"

#: Big enough to hold a whole clause, small enough that three of them fit in a
#: prompt without crowding out the products. Measured in characters because the
#: tokeniser is behind the model seam and this module must not know which model.
CHUNK = 700
OVERLAP = 120


@dataclass
class Passage:
    id: str
    source: str
    text: str
    #: Which heading this sat under, when the document had one. Retrieval hits a
    #: paragraph; a person needs to know what it was about.
    heading: str = ""


def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init() -> None:
    with _connect() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS passages (
                org_id TEXT NOT NULL DEFAULT 'default',
                id TEXT NOT NULL,
                source TEXT NOT NULL,
                heading TEXT,
                text TEXT NOT NULL,
                PRIMARY KEY (org_id, id)
            );
            CREATE VIRTUAL TABLE IF NOT EXISTS passages_fts
            USING fts5(org_id UNINDEXED, id UNINDEXED, heading, text);

            CREATE TRIGGER IF NOT EXISTS passages_ai AFTER INSERT ON passages BEGIN
              INSERT INTO passages_fts(org_id, id, heading, text)
              VALUES (new.org_id, new.id, new.heading, new.text);
            END;
            CREATE TRIGGER IF NOT EXISTS passages_ad AFTER DELETE ON passages BEGIN
              DELETE FROM passages_fts WHERE id = old.id AND org_id = old.org_id;
            END;
            CREATE TRIGGER IF NOT EXISTS passages_au AFTER UPDATE ON passages BEGIN
              DELETE FROM passages_fts WHERE id = old.id AND org_id = old.org_id;
              INSERT INTO passages_fts(org_id, id, heading, text)
              VALUES (new.org_id, new.id, new.heading, new.text);
            END;
        """)


_HEADING = re.compile(r"^\s{0,3}(#{1,4}\s+.+|[A-Z][A-Za-z0-9 ,'&/()-]{3,60})\s*$")


def chunk(text: str, source: str) -> list[Passage]:
    """Split a document into retrievable passages.

    Paragraph boundaries first, character count second. Cutting mid-sentence to
    hit an exact size produces passages that retrieve well and read as nonsense
    when the model quotes them back to a customer out loud.
    """
    passages: list[Passage] = []
    heading = ""
    buffer: list[str] = []

    def flush() -> None:
        joined = "\n".join(buffer).strip()
        buffer.clear()
        if not joined:
            return
        for piece in _split(joined):
            passages.append(
                Passage(
                    id=f"{source}#{len(passages):03d}",
                    source=source,
                    heading=heading,
                    text=piece,
                )
            )

    for block in re.split(r"\n\s*\n", text):
        block = block.strip()
        if not block:
            continue
        # A short line in title case is a heading far more often than it is a
        # sentence, and carrying it onto the passages beneath it is most of what
        # makes a retrieved fragment intelligible.
        if len(block) < 70 and "\n" not in block and _HEADING.match(block):
            flush()
            heading = block.lstrip("# ").strip()
            continue
        buffer.append(block)
        if sum(len(b) for b in buffer) >= CHUNK:
            flush()

    flush()
    return passages


def _split(text: str) -> list[str]:
    """Character-bounded windows with an overlap, so a fact that straddles a
    boundary is still whole in one of them."""
    if len(text) <= CHUNK:
        return [text]
    pieces, start = [], 0
    while start < len(text):
        end = min(start + CHUNK, len(text))
        if end < len(text):
            # Prefer to break at a sentence, then at a space.
            window = text[start:end]
            cut = max(window.rfind(". "), window.rfind("\n"))
            if cut > CHUNK // 2:
                end = start + cut + 1
        pieces.append(text[start:end].strip())
        if end >= len(text):
            break
        start = max(end - OVERLAP, start + 1)
    return [p for p in pieces if p]


def upsert(passages: list[Passage], org_id: str = DEFAULT_ORG) -> int:
    init()
    with _connect() as conn:
        conn.executemany(
            """
            INSERT INTO passages (org_id, id, source, heading, text)
            VALUES (:org_id, :id, :source, :heading, :text)
            ON CONFLICT(org_id, id) DO UPDATE SET
                source=excluded.source, heading=excluded.heading, text=excluded.text
            """,
            [{"org_id": org_id, **asdict(p)} for p in passages],
        )
    return len(passages)


def replace_source(source: str, passages: list[Passage], org_id: str = DEFAULT_ORG) -> int:
    """Re-uploading a document replaces it.

    Without this, a shortened policy leaves its deleted paragraphs in the index
    and the avatar keeps quoting a rule the company withdrew.
    """
    init()
    with _connect() as conn:
        conn.execute(
            "DELETE FROM passages WHERE org_id = ? AND source = ?", (org_id, source)
        )
    return upsert(passages, org_id)


def sources(org_id: str = DEFAULT_ORG) -> list[dict]:
    init()
    with _connect() as conn:
        rows = conn.execute(
            "SELECT source, COUNT(*) passages, SUM(LENGTH(text)) characters "
            "FROM passages WHERE org_id = ? GROUP BY source ORDER BY source",
            (org_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def delete_source(source: str, org_id: str = DEFAULT_ORG) -> int:
    init()
    with _connect() as conn:
        cursor = conn.execute(
            "DELETE FROM passages WHERE org_id = ? AND source = ?", (org_id, source)
        )
    return cursor.rowcount


def reassign_org(from_org: str, to_org: str) -> int:
    if from_org == to_org:
        return 0
    init()
    with _connect() as conn:
        cursor = conn.execute(
            "UPDATE passages SET org_id = ? WHERE org_id = ?", (to_org, from_org)
        )
    return cursor.rowcount


def search(query: str, limit: int = 3, org_id: str = DEFAULT_ORG) -> list[Passage]:
    """The company's own words on this subject, best first.

    Three by default. A model given ten passages answers from the longest one
    rather than the most relevant, and the prompt still has to carry a catalog.
    """
    from backend.catalog import _fts_query

    init()
    expression = _fts_query(query)
    if not expression:
        return []

    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT p.id, p.source, p.heading, p.text
            FROM passages_fts f JOIN passages p ON p.id = f.id AND p.org_id = f.org_id
            WHERE passages_fts MATCH ? AND p.org_id = ?
            ORDER BY bm25(passages_fts) LIMIT ?
            """,
            (expression, org_id, limit),
        ).fetchall()
    return [Passage(r["id"], r["source"], r["text"], r["heading"]) for r in rows]


def as_context(passages: list[Passage]) -> str:
    """What goes into the prompt. Sources are named so the model can attribute,
    and so a wrong answer can be traced to the document that caused it."""
    if not passages:
        return ""
    blocks = [
        f"[{p.source}{' — ' + p.heading if p.heading else ''}]\n{p.text}" for p in passages
    ]
    return "\n\n".join(blocks)
