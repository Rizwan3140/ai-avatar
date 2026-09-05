"""The product catalog — storage and search.

SQLite with FTS5, which ships inside Python. No vector database, no embedding
API, no new dependency. Keyword search over a well-built index answers "show me
black formal shirts" and "laptops under fifty thousand" perfectly well; the point
at which it stops being enough is measurable, and embeddings can be added behind
`search()` on that day rather than this one.

The schema is deliberately not laptop-shaped. Luxora has to serve fashion,
electronics, automobile, hotel and retail from one platform, so a fixed column
set would mean migrating every customer's catalog the first time someone sells a
dress. Core fields are the ones every vertical has; everything else lives in
`attributes`.

Every row carries an `org_id`. It is a column rather than a database per tenant
because one company's catalog is a few thousand rows, and because a query that
forgets the filter is easier to catch in one place than a connection pointed at
the wrong file. `org_id` is not part of `Product` on purpose: it says who owns the
row, not what the product is, and nothing above this module should be able to
read it off an object and send it somewhere.
"""

import json
import re
import sqlite3
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from backend import config

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = config.DATA / "knowledge" / "catalog.db"

# Columns every vertical genuinely shares. A dress, a laptop and a hotel room all
# have a name, a category, a price and a picture. None of them share "RAM".
CORE = ("id", "name", "category", "price", "currency", "description", "url", "image", "availability")

#: Everything that existed before tenancy belongs to this org. Without a default
#: the first upgrade orphans the catalog already on disk.
DEFAULT_ORG = "default"

#: The colours this catalog actually uses, longest first.
#:
#: Order is the whole trick. "Rose Gold" has to be tested before "Gold" and
#: "Sea Green" before "Green", or every rose gold bangle is filed as gold and
#: the distinction the customer can see on the shelf is gone from the data.
#:
#: Read from the catalog rather than invented: these are the colour words that
#: appear in the supplier's own tags, which is why "Multi" is here — it is a
#: real answer to "what colour is it", and the alternative is 417 products with
#: no colour at all.
COLORS = (
    "Turquoise Blue",
    "Rose Gold",
    "Sea Green",
    "Maroon",
    "Orange",
    "Purple",
    "Silver",
    "Yellow",
    "Beige",
    "Black",
    "Brown",
    "Cream",
    "Green",
    "Multi",
    "Peach",
    "White",
    "Blue",
    "Gold",
    "Grey",
    "Pink",
    "Red",
)

#: Occasion, as the shop itself labels it. Keyed by what we call it, valued by
#: what the supplier's tags say — "Wedding Lehengas" and "Party Wear Lehengas"
#: are the same two facts wearing a category name, and a visitor asking for
#: something for a wedding does not care which product type it came attached to.
STYLES: dict[str, tuple[str, ...]] = {
    "Wedding": ("wedding",),
    "Party Wear": ("party wear",),
    "Festive": ("festive",),
    "Valentine": ("valentine",),
    "Exclusive": ("exclusive",),
}


def _tags_of(attributes: dict[str, Any]) -> list[str]:
    raw = attributes.get("tags") or ""
    return [t.strip() for t in str(raw).split(",") if t.strip()]


def facets_of(name: str, description: str, attributes: dict[str, Any]) -> tuple[str, str]:
    """The colour and occasion of one product, as ("Red", "Festive").

    Tags first, because the shop labelled these itself and a label beats a
    guess. Only when the tags are silent does this read the name and the
    description, where "Midnight Blue Silk Saree" still says blue perfectly
    clearly — 4,991 of 5,000 rows here have tags, and the remaining nine are
    exactly the ones a text scan is for.

    Either half may come back empty. A product with no colour word anywhere is
    a product whose colour we do not know, and writing "Multi" over that would
    put a fact in the database that nobody established.
    """
    tags = _tags_of(attributes)
    lowered = [t.lower() for t in tags]

    color = next((c for c in COLORS if c.lower() in lowered), "")
    if not color:
        # Word-boundary matched: "Red" must not be found inside "Shredded", and
        # a substring scan is how a catalog quietly fills up with wrong colours.
        haystack = f"{name} {description}".lower()
        color = next(
            (c for c in COLORS if re.search(rf"\b{re.escape(c.lower())}\b", haystack)),
            "",
        )

    blob = " ".join(lowered)
    style = next(
        (label for label, needles in STYLES.items() if any(n in blob for n in needles)),
        "",
    )
    return color, style


@dataclass
class Product:
    id: str
    name: str
    category: str = ""
    price: float | None = None
    currency: str = "INR"
    description: str = ""
    url: str = ""
    image: str = ""
    availability: str = "in_stock"
    #: Whatever this vertical needs — size, colour, RAM, fabric, bed type.
    attributes: dict[str, Any] = field(default_factory=dict)

    def spoken_price(self) -> str:
        """Prices are read aloud, so "12,990" must not be spoken digit by digit."""
        if self.price is None:
            return ""
        symbol = {"INR": "₹", "USD": "$", "EUR": "€"}.get(self.currency, "")
        return f"{symbol}{self.price:,.0f}"

    def as_line(self) -> str:
        """One product as a line for the system prompt. Compact on purpose — this
        is charged per token and read by a model, not a person."""
        bits = [self.name]
        if self.category:
            bits.append(f"({self.category})")
        if self.price is not None:
            bits.append(self.spoken_price())
        if self.description:
            bits.append(f"- {self.description}")
        for key, value in self.attributes.items():
            bits.append(f"{key}: {value}")
        return " ".join(bits)


def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


_SCHEMA = """
    CREATE TABLE IF NOT EXISTS products (
        org_id TEXT NOT NULL DEFAULT 'default',
        id TEXT NOT NULL,
        name TEXT NOT NULL,
        category TEXT,
        price REAL,
        currency TEXT,
        description TEXT,
        url TEXT,
        image TEXT,
        availability TEXT,
        attributes TEXT,
        -- Derived at write time from the tags, not asked of the caller. They are
        -- columns rather than a lookup into `attributes` because "show me the
        -- red ones" is a filter, and filtering on JSON means reading every row
        -- to answer it.
        color TEXT,
        style TEXT,
        -- Composite, not `id` alone. Two customers exporting a product called
        -- "Titan Pro 16" both slug to `titan-pro-16`, and with a single-column
        -- key the second ingest silently overwrites the first company's row.
        PRIMARY KEY (org_id, id)
    );
    -- An external-content FTS table would stay in sync automatically but
    -- complicates upserts; the catalog is small and rebuilt on ingest, so a
    -- plain index kept in step by triggers is simpler and just as correct.
    CREATE VIRTUAL TABLE IF NOT EXISTS products_fts
    USING fts5(org_id UNINDEXED, id UNINDEXED, name, category, description, attributes);

    CREATE TRIGGER IF NOT EXISTS products_ai AFTER INSERT ON products BEGIN
      INSERT INTO products_fts(org_id, id, name, category, description, attributes)
      VALUES (new.org_id, new.id, new.name, new.category, new.description, new.attributes);
    END;
    CREATE TRIGGER IF NOT EXISTS products_ad AFTER DELETE ON products BEGIN
      DELETE FROM products_fts WHERE id = old.id AND org_id = old.org_id;
    END;
    CREATE TRIGGER IF NOT EXISTS products_au AFTER UPDATE ON products BEGIN
      DELETE FROM products_fts WHERE id = old.id AND org_id = old.org_id;
      INSERT INTO products_fts(org_id, id, name, category, description, attributes)
      VALUES (new.org_id, new.id, new.name, new.category, new.description, new.attributes);
    END;
"""


def _migrate(conn: sqlite3.Connection) -> None:
    """Bring a pre-tenancy database forward.

    The old `products` table keyed on `id` alone and had no `org_id`. Rebuilding
    is the only way to change a primary key in SQLite, and the rows already there
    are a real customer's catalog — they move to the default org rather than being
    dropped and re-ingested, because nobody keeps the CSV.
    """
    tables = {r["name"] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if "products" not in tables:
        return
    columns = {r["name"] for r in conn.execute("PRAGMA table_info(products)")}
    if "org_id" in columns:
        return

    conn.executescript("""
        DROP TRIGGER IF EXISTS products_ai;
        DROP TRIGGER IF EXISTS products_ad;
        DROP TRIGGER IF EXISTS products_au;
        DROP TABLE IF EXISTS products_fts;
        ALTER TABLE products RENAME TO products_pre_tenancy;
    """)
    conn.executescript(_SCHEMA)
    conn.execute(f"""
        INSERT INTO products (org_id, {', '.join(CORE)}, attributes)
        SELECT '{DEFAULT_ORG}', {', '.join(CORE)}, attributes FROM products_pre_tenancy
    """)
    conn.execute("DROP TABLE products_pre_tenancy")


def _add_facet_columns(conn: sqlite3.Connection) -> None:
    """Give an existing catalog its colour and style columns.

    A plain `ALTER TABLE ... ADD COLUMN`, because unlike the tenancy migration
    above there is no key to change — and the rows already on disk are a real
    customer's catalog, so they are backfilled from their own tags rather than
    left blank until somebody re-ingests a CSV nobody kept.
    """
    tables = {r["name"] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if "products" not in tables:
        return
    columns = {r["name"] for r in conn.execute("PRAGMA table_info(products)")}
    missing = [c for c in ("color", "style") if c not in columns]
    for column in missing:
        conn.execute(f"ALTER TABLE products ADD COLUMN {column} TEXT")
    if not missing:
        return

    rows = conn.execute("SELECT org_id, id, name, description, attributes FROM products").fetchall()
    updates = []
    for row in rows:
        try:
            attributes = json.loads(row["attributes"] or "{}")
        except (TypeError, ValueError):
            attributes = {}
        color, style = facets_of(row["name"] or "", row["description"] or "", attributes)
        updates.append((color, style, row["org_id"], row["id"]))
    conn.executemany(
        "UPDATE products SET color = ?, style = ? WHERE org_id = ? AND id = ?", updates
    )


def init() -> None:
    with _connect() as conn:
        _migrate(conn)
        conn.executescript(_SCHEMA)
        _add_facet_columns(conn)


def _row_to_product(row: sqlite3.Row) -> Product:
    data = {key: row[key] for key in CORE}
    data["attributes"] = json.loads(row["attributes"] or "{}")
    return Product(**data)


def upsert(products: list[Product], org_id: str = DEFAULT_ORG) -> int:
    init()
    with _connect() as conn:
        conn.executemany(
            """
            INSERT INTO products (org_id, id, name, category, price, currency, description,
                                  url, image, availability, attributes, color, style)
            VALUES (:org_id, :id, :name, :category, :price, :currency, :description,
                    :url, :image, :availability, :attributes, :color, :style)
            ON CONFLICT(org_id, id) DO UPDATE SET
                name=excluded.name, category=excluded.category, price=excluded.price,
                currency=excluded.currency, description=excluded.description,
                url=excluded.url, image=excluded.image,
                availability=excluded.availability, attributes=excluded.attributes,
                color=excluded.color, style=excluded.style
            """,
            [
                {
                    "org_id": org_id,
                    **{k: getattr(p, k) for k in CORE},
                    # Attribute values are indexed as text so "cotton" or "16GB"
                    # are searchable without the caller knowing the key.
                    "attributes": json.dumps(p.attributes, ensure_ascii=False),
                    # Derived here, once, rather than at every read. An ingest
                    # is rare and a search is not.
                    **dict(
                        zip(
                            ("color", "style"),
                            facets_of(p.name, p.description, p.attributes),
                        )
                    ),
                }
                for p in products
            ],
        )
    return len(products)


def all_products(org_id: str = DEFAULT_ORG) -> list[Product]:
    init()
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM products WHERE org_id = ? ORDER BY name", (org_id,)
        ).fetchall()
    return [_row_to_product(r) for r in rows]


def get(product_id: str, org_id: str = DEFAULT_ORG) -> Product | None:
    init()
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM products WHERE id = ? AND org_id = ?", (product_id, org_id)
        ).fetchone()
    return _row_to_product(row) if row else None


def delete(product_id: str, org_id: str = DEFAULT_ORG) -> bool:
    init()
    with _connect() as conn:
        cursor = conn.execute(
            "DELETE FROM products WHERE id = ? AND org_id = ?", (product_id, org_id)
        )
    return cursor.rowcount > 0


def clear(org_id: str = DEFAULT_ORG) -> int:
    """Empty one org's catalog.

    Exists because a customer's first act is uploading their own products, and
    until now the sample data could only be removed one row at a time — so a
    showroom selling sarees also sold a Titan Pro 16, and the avatar would
    happily recommend it.
    """
    init()
    with _connect() as conn:
        cursor = conn.execute("DELETE FROM products WHERE org_id = ?", (org_id,))
    return cursor.rowcount


def reassign_org(from_org: str, to_org: str) -> int:
    """Move a catalog between orgs.

    Exists for exactly one moment: the first person signs up on a machine that
    already had products on it, and those products must follow them rather than
    vanish behind a tenant filter they are not on the right side of.
    """
    if from_org == to_org:
        return 0
    init()
    with _connect() as conn:
        cursor = conn.execute(
            "UPDATE products SET org_id = ? WHERE org_id = ?", (to_org, from_org)
        )
    return cursor.rowcount


def categories(org_id: str = DEFAULT_ORG) -> list[str]:
    init()
    with _connect() as conn:
        rows = conn.execute(
            "SELECT DISTINCT category FROM products WHERE category != '' AND org_id = ? "
            "ORDER BY category",
            (org_id,),
        ).fetchall()
    return [r["category"] for r in rows]


def _facet_values(column: str, org_id: str) -> list[str]:
    """The values one facet actually takes in this catalog.

    Read from the rows rather than returned from the vocabulary above, so a
    shop that sells nothing green is never offered a green filter that comes
    back empty. `column` is never caller-supplied — the two callers below pass
    a literal, which is what keeps this interpolation safe.
    """
    init()
    with _connect() as conn:
        rows = conn.execute(
            f"SELECT DISTINCT {column} AS v FROM products "
            f"WHERE {column} IS NOT NULL AND {column} != '' AND org_id = ? ORDER BY v",
            (org_id,),
        ).fetchall()
    return [r["v"] for r in rows]


def colors(org_id: str = DEFAULT_ORG) -> list[str]:
    return _facet_values("color", org_id)


def styles(org_id: str = DEFAULT_ORG) -> list[str]:
    return _facet_values("style", org_id)


# Words that carry no product meaning. Without this list a visitor saying
# "show me laptops" matches a keyboard, because the prefix "me*" hits
# "mechanical" — the kind of result that looks broken in a showroom.
STOPWORDS = frozenset("""
a an and any are as at be but by can could do does for from get give got has have
he her him his how i if in is it its like looking me my need of on or our out
please see she show some something that the their them then there these they this
those to us want was we what when where which who will with would you your
""".split())


def _fts_query(text: str) -> str:
    """Turn what a person said into something FTS5 will accept.

    Visitors speak in sentences, and raw punctuation is a syntax error in FTS5.
    Meaningful words are OR-ed together so a partial phrase still returns its best
    matches rather than nothing.
    """
    words = [w.lower() for w in "".join(c if c.isalnum() else " " for c in text).split()]
    kept = [w for w in words if w not in STOPWORDS and len(w) > 2]

    # Prefix matching only from four characters. "car*" would hit "cardigan" and
    # "carton"; "lapt*" only ever means laptop.
    return " OR ".join(f"{w}*" if len(w) > 3 else w for w in kept)


def search(
    query: str = "",
    category: str = "",
    max_price: float | None = None,
    limit: int = 8,
    org_id: str = DEFAULT_ORG,
    per_category: bool = True,
    color: str = "",
    style: str = "",
) -> list[Product]:
    """Find products. Everything is optional — an empty query with a category is
    "show me your laptops", and an empty everything is "show me what you have".

    `org_id` is not optional in effect: it is always applied. This is the query
    that feeds the model, so a missing tenant filter would not be a leak in a
    dashboard — it would be one company's avatar quoting another company's prices
    out loud to a customer.
    """
    init()
    # Always present, always first. A tenant filter that is one branch among
    # several is a tenant filter that a later edit can drop.
    clauses: list[str] = ["p.org_id = ?"]
    params: list[Any] = [org_id]
    joined = "products p"
    order = "p.name"

    if query.strip():
        expression = _fts_query(query)
        if expression:
            joined = "products_fts f JOIN products p ON p.id = f.id AND p.org_id = f.org_id"
            clauses.append("products_fts MATCH ?")
            params.append(expression)
            # bm25 favours rarer terms, so a specific model name beats a generic
            # category word — which is what someone naming a product expects.
            order = "bm25(products_fts)"

    if category:
        clauses.append("LOWER(p.category) = LOWER(?)")
        params.append(category)

    if color:
        clauses.append("LOWER(p.color) = LOWER(?)")
        params.append(color)

    if style:
        clauses.append("LOWER(p.style) = LOWER(?)")
        params.append(style)

    if max_price is not None:
        clauses.append("p.price IS NOT NULL AND p.price <= ?")
        params.append(max_price)

    # Thinning is for the browse case. Somebody who named a category has already
    # narrowed it themselves, and answering "show me the sarees" with exactly one
    # saree is a worse showroom than the wall it was meant to prevent.
    #
    # A colour is the same kind of narrowing: "show me the red ones" is a request
    # for the red ones, and thinning it to one red product per category answers a
    # question nobody asked.
    thin = per_category and not category and not color

    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    sql = f"SELECT p.* FROM {joined} {where} ORDER BY {order} LIMIT ?"
    # Over-fetch, then thin. The thinning below keeps one row per category, so
    # asking the database for `limit` rows would return one category's worth of
    # near-duplicates and thin them to a single product.
    params.append(limit * FAN_OUT if thin else limit)

    with _connect() as conn:
        rows = conn.execute(sql, params).fetchall()
    found = [_row_to_product(r) for r in rows]
    return _one_per_category(found, limit) if thin else found[:limit]


#: How much wider to cast the net before thinning to one product per category.
#: A catalog of five thousand shirts is mostly shirts, so the first handful of
#: matches are usually the same category over and over.
FAN_OUT = 12


def _one_per_category(products: list[Product], limit: int) -> list[Product]:
    """The best match from each category, in the order they were ranked.

    A wall of thirty sarees is not a showroom, it is a search results page, and
    it puts the visitor back in the job the avatar exists to do for them. One of
    each says what the shop sells; the conversation narrows from there, which is
    the thing a person standing in front of you is for.

    Products with no category each stand alone rather than collapsing into one
    anonymous group — an uncategorised catalog would otherwise show exactly one
    product for every possible question.
    """
    seen: set[str] = set()
    picked: list[Product] = []
    for product in products:
        key = (product.category or "").strip().lower()
        if key and key in seen:
            continue
        if key:
            seen.add(key)
        picked.append(product)
        if len(picked) >= limit:
            break
    return picked


#: "under 50000", "below ₹2,000", "less than 300", "cheaper than 99.99"
_PRICE_LIMIT = re.compile(
    r"(?:under|below|less than|cheaper than|max|upto|up to|within)\s*[₹$€]?\s*([\d,]+(?:\.\d+)?)",
    re.I,
)


def parse_query(text: str) -> tuple[str, float | None]:
    """Pull a price ceiling out of what someone said.

    "Do you have anything under fifty thousand" is a filter, not a search term —
    leaving "under 50000" in the text matches the digits against product copy and
    returns noise. Pure and separately tested.
    """
    match = _PRICE_LIMIT.search(text)
    if not match:
        return text.strip(), None
    try:
        limit = float(match.group(1).replace(",", ""))
    except ValueError:
        return text.strip(), None
    return _PRICE_LIMIT.sub("", text).strip(), limit


def parse_facets(text: str) -> tuple[str, str, str]:
    """Pull a colour and an occasion out of what someone said.

    "Show me the red sarees" is a filter and a search term, not one long search
    term. Left in the text, "red" is matched against product copy by FTS, which
    ranks a saree whose description happens to say "red" above the sarees the
    shop has actually tagged red — so the word is lifted out and applied as the
    column filter it is, exactly as `parse_query` does with a price ceiling.

    Longest colour first, so "rose gold" is not read as "gold". Pure and
    separately tested; returns the text with the matched words removed.
    """
    remaining = text
    found_color = ""
    for candidate in COLORS:
        pattern = rf"\b{re.escape(candidate.lower())}\b"
        if re.search(pattern, remaining, flags=re.IGNORECASE):
            found_color = candidate
            remaining = re.sub(pattern, " ", remaining, flags=re.IGNORECASE)
            break

    found_style = ""
    for label, needles in STYLES.items():
        for needle in needles:
            pattern = rf"\b{re.escape(needle)}\b"
            if re.search(pattern, remaining, flags=re.IGNORECASE):
                found_style = label
                remaining = re.sub(pattern, " ", remaining, flags=re.IGNORECASE)
                break
        if found_style:
            break

    return " ".join(remaining.split()), found_color, found_style


def to_dict(product: Product) -> dict:
    return {**asdict(product), "spoken_price": product.spoken_price()}
