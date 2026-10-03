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

import difflib
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


#: The rails a showroom is browsed by. A visitor tapping "Men's wear" is not
#: asking for one shelf — this shop's men's pieces sit on three — and nobody
#: asking for clothes wants a nose ring in the middle of them.
MEN, WOMEN, JEWELLERY, ACCESSORIES = "men", "women", "jewellery", "accessories"

#: The two that are not garments. Kept apart from clothes in every list, and
#: from each other on the panel: a rakhi and a potli are accessories, and
#: filing them with the earrings put Rakhis first among the jewellery.
EXTRAS = (JEWELLERY, ACCESSORIES)

#: What each is called out loud, for the prompt and the panel's heading.
DEPARTMENT_LABELS = {
    MEN: "Men's wear",
    WOMEN: "Women's wear",
    JEWELLERY: "Jewellery",
    ACCESSORIES: "Accessories",
}

#: Bumped when the rules below change, so catalogs derived under the old ones
#: are derived again. See `_add_facet_columns`.
DEPARTMENT_RULES = 5

#: Shelf names that are jewellery, and shelf names that are accessories.
#: Matched against the shelf's own words: a dress tagged "with belt" is still a
#: dress, and a shelf called Rakhis is rakhis whatever else it is tagged.
_JEWELLERY_SHELVES = frozenset(
    "jewellery jewelry jewelery earring earrings bangle bangles ring rings "
    "necklace necklaces bracelet bracelets anklet anklets nath naths pendant "
    "pendants jhumka jhumkas".split()
)
_ACCESSORY_SHELVES = frozenset(
    "accessories accessory bag bags belt belts rakhi rakhis watch watches "
    "wallet wallets clutch clutches potli potlis".split()
)

#: The shop's own tag for each, read only when the shelf name says neither.
_JEWELLERY_TAGS = frozenset({"jewellery", "jewelry", "jewelery"})
_ACCESSORY_TAGS = frozenset({"accessories", "accessory"})


def department_of(name: str, category: str, attributes: dict[str, Any]) -> str:
    """Which rail one product hangs on: "men", "women", "jewellery",
    "accessories" or "".

    The shop's own labels, for the reason `facets_of` gives. 193 rows here are
    tagged Women and 22 Men; the name is read only where the tags say nothing.

    For jewellery against accessories the shelf name is read before the tags,
    because here the tags do not tell the two apart: this shop's rakhis are
    tagged "Accessories, Jewellery", and its belts — on a shelf called
    Accessories — are tagged "Jewellery, Earrings".

    Not-a-garment wins over who it is for: earrings tagged Women are jewellery,
    which is the whole point of keeping them apart from clothes.

    Empty means we do not know, or it is for anyone (tagged both, or Unisex).
    Such a row is still found by search; it simply sits on neither gendered
    rail, which beats guessing a customer's shirt into the wrong one.
    """
    # A tag is a phrase ("Mens collection", "Ethnic Bags", `Women"` with a stray
    # quote in this export), so it is read as words.
    words = {w for tag in _tags_of(attributes) for w in re.findall(r"[a-z]+", tag.lower())}
    # A product with no shelf at all is placed by its tags instead: this shop
    # has a potli filed nowhere and tagged "Ethnic Bags", which was being
    # counted as women's clothing.
    shelf = set(re.findall(r"[a-z]+", (category or "").lower())) or words
    if shelf & _JEWELLERY_SHELVES:
        return JEWELLERY
    if shelf & _ACCESSORY_SHELVES:
        return ACCESSORIES
    # An Accessories tag before a Jewellery one: it is the narrower claim.
    if words & _ACCESSORY_TAGS:
        return ACCESSORIES
    if words & _JEWELLERY_TAGS:
        return JEWELLERY

    men = bool(words & {"men", "mens", "gents"})
    women = bool(words & {"women", "womens", "ladies"})
    if not men and not women:
        # `\bmen` cannot match inside "women": the "o" before it is a word character.
        # `type` is what the shop called it before the shelf was made simple:
        # "Men's Kurtas" is filed on Kurtas, and still says who it is for.
        text = f"{name} {category} {attributes.get('type') or ''}".lower()
        men = bool(re.search(r"\b(men'?s?|gents)\b", text))
        women = bool(re.search(r"\b(women'?s?|ladies)\b", text))
    if men == women:
        return ""
    return MEN if men else WOMEN


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
    #: Every photograph of this product, in the order the shop published them.
    #:
    #: `image` stays the primary and is what a grid cell shows, so nothing that
    #: reads one picture has to learn about a list. This is the rest of them.
    #: A storefront publishes five or six shots of a garment — front, back,
    #: fabric, worn — and the crawler was keeping the first and discarding the
    #: others, which is most of what a customer wants to see before buying.
    images: list[str] = field(default_factory=list)
    #: A clip the shop published for this product — schema.org's `video`
    #: property on a Product node. Empty for the overwhelming majority, which
    #: is why it is a plain string rather than a list: one clip is what a shop
    #: window plays, and a product with several would need a real reason to
    #: pick among them before this grows into `videos`.
    video: str = ""
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
        -- JSON, like `attributes`, because it is a list and SQLite has no array.
        -- Not a second table: a handful of URLs per row is not a relation, and a
        -- join would be paid on every read of the one query that feeds a panel.
        images TEXT,
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

    -- `categories()` runs up to three times per spoken turn; without this it is
    -- a full-table scan each time.
    CREATE INDEX IF NOT EXISTS products_org_category ON products(org_id, category);

    -- Linked by rowid, never by `id`/`org_id`. Those are UNINDEXED in FTS5, so
    -- `WHERE id = old.id` scanned the whole index once per changed row: a sync
    -- tick replacing 5,000 unchanged products took 11s and a re-import 17s,
    -- write-locking the database while every visitor's search waited behind it.
    CREATE TRIGGER IF NOT EXISTS products_ai AFTER INSERT ON products BEGIN
      INSERT INTO products_fts(rowid, org_id, id, name, category, description, attributes)
      VALUES (new.rowid, new.org_id, new.id, new.name, new.category, new.description, new.attributes);
    END;
    CREATE TRIGGER IF NOT EXISTS products_ad AFTER DELETE ON products BEGIN
      DELETE FROM products_fts WHERE rowid = old.rowid;
    END;
    CREATE TRIGGER IF NOT EXISTS products_au AFTER UPDATE ON products BEGIN
      DELETE FROM products_fts WHERE rowid = old.rowid;
      INSERT INTO products_fts(rowid, org_id, id, name, category, description, attributes)
      VALUES (new.rowid, new.org_id, new.id, new.name, new.category, new.description, new.attributes);
    END;
"""


def _link_fts_by_rowid(conn: sqlite3.Connection) -> None:
    """Rebuild an index written by the old id-matched triggers.

    `CREATE TRIGGER IF NOT EXISTS` never replaces one, and the old index's
    rowids are unrelated to the products', so both are rebuilt once from the
    rows themselves.
    """
    row = conn.execute("SELECT sql FROM sqlite_master WHERE name = 'products_ad'").fetchone()
    if row is None or "rowid" in row["sql"]:
        return
    conn.executescript("""
        DROP TRIGGER IF EXISTS products_ai;
        DROP TRIGGER IF EXISTS products_ad;
        DROP TRIGGER IF EXISTS products_au;
        DROP TABLE IF EXISTS products_fts;
    """)
    conn.executescript(_SCHEMA)
    conn.execute("""
        INSERT INTO products_fts(rowid, org_id, id, name, category, description, attributes)
        SELECT rowid, org_id, id, name, category, description, attributes FROM products
    """)


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
    missing = [c for c in ("color", "style", "images", "video", "department") if c not in columns]
    for column in missing:
        conn.execute(f"ALTER TABLE products ADD COLUMN {column} TEXT")
    # The department rail is browsed and counted on every tile screen.
    conn.execute(
        "CREATE INDEX IF NOT EXISTS products_org_department "
        "ON products(org_id, department, category)"
    )
    # Fill in whichever rows lack a derived value, not "all rows when a column
    # is new". A column added just now is NULL throughout — and so is any row
    # written since by an older release chosen from the version menu, which
    # knows nothing of `department`. Derived values are never NULL once set
    # ("" means "not known"), so a healthy catalog selects nothing here.
    #
    # And every row when the rules themselves have changed. A department is
    # derived once and stored, so a catalog that filed its rakhis under the old
    # rule would keep them there — `user_version` is the rules it was derived
    # under, and an older one derives the lot again.
    stale = conn.execute("PRAGMA user_version").fetchone()[0] < DEPARTMENT_RULES
    conn.execute(f"PRAGMA user_version = {DEPARTMENT_RULES}")
    _categorise(conn, everything=stale)


def _categorise(conn: sqlite3.Connection, everything: bool) -> int:
    """File products already on disk: shelf, colour, occasion, department.

    The same four steps a product goes through when it is written — `shelved`,
    `facets_of`, `department_of`, `_settle_departments` — run over rows that are
    already stored. `everything` is every row; otherwise only the rows that are
    missing a derived value. Returns how many rows it went over.
    """
    rows = conn.execute(
        "SELECT org_id, id, name, category, description, attributes FROM products"
        + ("" if everything else " WHERE color IS NULL OR style IS NULL OR department IS NULL")
    ).fetchall()
    if not rows:
        return 0
    # Each org's own shelves, for the rows that have none. See `shelved`.
    shelves_of: dict[str, list[str]] = {}
    for found in conn.execute(
        "SELECT DISTINCT org_id, category FROM products WHERE IFNULL(category, '') != ''"
    ):
        shelves_of.setdefault(found["org_id"], []).append(found["category"])
    known = {org: _known_shelves(names) for org, names in shelves_of.items()}

    updates = []
    for row in rows:
        try:
            attributes = json.loads(row["attributes"] or "{}")
        except (TypeError, ValueError):
            attributes = {}
        # A blank shelf filled from the tags, a combination folded into a
        # simple one — exactly what a write does. See `shelved`.
        category, filed = _filed(row["category"], attributes, known.get(row["org_id"], {}))
        color, style = facets_of(row["name"] or "", row["description"] or "", filed)
        department = department_of(row["name"] or "", category, filed)
        # The attributes are rewritten only when filing changed them: a row
        # whose stored JSON could not be read keeps what it has.
        stored = (
            json.dumps(filed, ensure_ascii=False) if filed is not attributes else row["attributes"]
        )
        updates.append((category, stored, color, style, department, row["org_id"], row["id"]))
    conn.executemany(
        "UPDATE products SET category = ?, attributes = ?, color = ?, style = ?, department = ? "
        "WHERE org_id = ? AND id = ?",
        updates,
    )
    # And then each shelf answers for its unlabelled pieces. After the loop
    # above, which has just put every row back to its own label.
    for org in {row["org_id"] for row in rows}:
        _settle_departments(conn, org)
    return len(rows)


def categorise() -> int:
    """File every product in the catalog again, by the rules as they stand now.

    Nothing has to call this for new products: every write files what it
    writes. It is for looking at a catalog already on disk — `python -m
    backend.categorize` runs it and says what it found.
    """
    init()
    with _connect() as conn:
        return _categorise(conn, everything=True)


#: Databases already brought up to date by this process. `init()` runs at the top
#: of every read, and three of them happen per spoken turn.
_initialised: set[str] = set()


def init() -> None:
    # Re-run if the file went away: tests point DB_PATH at fresh temp files.
    if str(DB_PATH) in _initialised and DB_PATH.exists():
        return
    with _connect() as conn:
        _migrate(conn)
        _link_fts_by_rowid(conn)
        conn.executescript(_SCHEMA)
        _add_facet_columns(conn)
    _initialised.add(str(DB_PATH))


def _row_to_product(row: sqlite3.Row) -> Product:
    data = {key: row[key] for key in CORE}
    data["attributes"] = json.loads(row["attributes"] or "{}")
    # `images` arrived after the first installs, so a row written before it
    # simply has none — read defensively rather than migrating every catalog.
    try:
        data["images"] = json.loads(row["images"] or "[]")
    except (IndexError, KeyError, TypeError, ValueError):
        data["images"] = []
    try:
        data["video"] = row["video"] or ""
    except (IndexError, KeyError):
        data["video"] = ""
    return Product(**data)


_UPSERT_SQL = """
    INSERT INTO products (org_id, id, name, category, price, currency, description,
                          url, image, availability, attributes, color, style, images, video,
                          department)
    VALUES (:org_id, :id, :name, :category, :price, :currency, :description,
            :url, :image, :availability, :attributes, :color, :style, :images, :video,
            :department)
    ON CONFLICT(org_id, id) DO UPDATE SET
        name=excluded.name, category=excluded.category, price=excluded.price,
        currency=excluded.currency, description=excluded.description,
        url=excluded.url, image=excluded.image,
        availability=excluded.availability, attributes=excluded.attributes,
        color=excluded.color, style=excluded.style, images=excluded.images,
        video=excluded.video, department=excluded.department
"""


def gallery(product: Product) -> list[str]:
    """Every photograph of a product, primary first and no repeats.

    The primary is stored in `image` and repeated at the head of this list, so a
    caller wanting the whole gallery does not have to prepend one to the other —
    and a caller wanting one picture keeps reading `image` and never learns this
    exists. Order is the shop's own: a storefront leads with the shot it wants
    seen first, and reordering that is an opinion we do not have.
    """
    everything = ([product.image] if product.image else []) + list(product.images)
    return list(dict.fromkeys(u for u in everything if u))


def _bind(products: list[Product], org_id: str) -> list[dict]:
    return [
        {
            "org_id": org_id,
            **{k: getattr(p, k) for k in CORE},
            # Attribute values are indexed as text so "cotton" or "16GB"
            # are searchable without the caller knowing the key.
            "attributes": json.dumps(p.attributes, ensure_ascii=False),
            "images": json.dumps(gallery(p), ensure_ascii=False),
            "video": p.video,
            # Derived here, once, rather than at every read. An ingest
            # is rare and a search is not.
            **dict(
                zip(("color", "style"), facets_of(p.name, p.description, p.attributes))
            ),
            "department": department_of(p.name, p.category, p.attributes),
        }
        for p in products
    ]


def _shelf_from_tags(attributes: dict[str, Any], known: dict[str, str]) -> str:
    """The shelf a product with none belongs on, when its own tags say — or "".

    Only when a tag *is* the name of a shelf, singular or plural: "Sarees",
    "Ethnic Bags". Nothing is read from the name or the description, and a tag
    that merely mentions a shelf is not one. `known` maps a shelf's stemmed,
    lowered name to the shelf as the shop writes it.
    """
    for tag in _tags_of(attributes):
        shelf = known.get(_stem(tag.strip(" \"'").lower()))
        if shelf:
            return shelf
    return ""


def _known_shelves(names) -> dict[str, str]:
    return {_stem(n.strip().lower()): n for n in names if n and n.strip()}


#: What joins the parts of a combination: "Kurta And Pyjama Sets", "Kurta,
#: Jacket And Dhoti Sets", "Kurta, Pyjama & Dupatta Sets", "Suit Set With
#: Dupattas".
_JOINED = re.compile(r"\s*(?:,|&|/|\+|\band\b|\bwith\b)\s*", re.I)
#: "Men's Kurtas", "Women Pants": who it is for, in front of what it is.
_WHOSE = re.compile(r"^(?:men|women|ladies|gents)(?:['’]?s)?\s+", re.I)
_SETS = re.compile(r"\s*\bsets?\s*$", re.I)


def simple_shelf(shelf: str, known: dict[str, str]) -> str:
    """One shelf for what a shop lists as many, when the many are combinations.

    A storefront's product type describes the product, not the rail it hangs
    on. Dhiyona lists a kurta sold with trousers as "Kurta And Pyjama Sets",
    "Kurta, Jacket And Pyjama Sets", "Kurta And Dhoti Sets", "Kurta, Jacket And
    Dhoti Sets", "Kurta And Patiala Sets", "Kurta, Pyjama & Dupatta Sets" — and
    taken as written, Men's wear was twenty-four tiles of which seven said
    kurta. They are one rail: Kurta Sets.

    Three shapes, each folded into a simple shelf, and into one the shop
    already has wherever there is one. A name that merges several is never
    made.

    - **Who it is for, in front.** "Men's Kurtas" is Kurtas; the department is
      kept separately now, and both showed as a tile called Kurtas.
    - **Things joined.** The first is what it is; the rest is what it comes
      with. A set goes to that garment's Sets shelf, else to the garment's own.
    - **Things run together.** "Kurta Pyjama Sets" is the same combination with
      no "and" — folded only when the first word has a Sets shelf and every
      other word is itself a shelf, so "Pathani Kurta Sets" stays what it is.

    `known` maps a shelf's stemmed, lowered name to the shelf as the shop
    writes it. Returns the shelf unchanged when none of this applies.
    """
    name = shelf.strip()

    def have(candidate: str) -> str:
        return known.get(_stem(candidate.strip().lower()), "")

    name = _WHOSE.sub("", name) or name

    parts = [part.strip() for part in _JOINED.split(name) if part.strip()]
    if len(parts) > 1:
        lead = _SETS.sub("", parts[0]).strip()
        if lead and (_SETS.search(name) or _SETS.search(parts[0])):
            name = have(f"{lead} Sets") or have(f"{lead}s") or have(lead) or f"{lead} Sets"
        elif lead:
            # Not a set, and no shelf of its own to go to: left as the shop
            # wrote it rather than given a name we made up.
            name = have(f"{lead}s") or have(lead) or name

    words = name.split()
    if len(words) >= 3 and _SETS.search(name):
        sets = have(f"{words[0]} Sets")
        if sets and all(have(f"{word}s") or have(word) for word in words[1:-1]):
            name = sets

    return have(name) or name


def _filed(category: str, attributes: dict[str, Any], known: dict[str, str]) -> tuple[str, dict]:
    """The shelf a product is stored on, and its attributes as stored.

    A blank shelf is filled from the tags; any shelf is then made simple. When
    that changes what the shop called it, the shop's own word is kept in
    `attributes["type"]` — so "kurta pyjama set" still finds it, the model is
    still told what it is, and `department_of` can still read "Men's" there.
    """
    shelf = category if (category or "").strip() else _shelf_from_tags(attributes, known)
    if not (shelf or "").strip():
        return category, attributes
    simple = simple_shelf(shelf, known)
    if simple != shelf and (category or "").strip():
        attributes = {**attributes, "type": attributes.get("type") or category}
    return simple, attributes


def listed_as(category: str, attributes: dict[str, Any]) -> str:
    """What the shop itself called this kind of product: its original type where
    the shelf was made simple, otherwise the shelf."""
    return str(attributes.get("type") or category or "")


def shelved(products: list[Product], also: list[str] | None = None) -> list[Product]:
    """The same products, each on the shelf it will be stored on.

    A product that came without a shelf is given the one its tags name. This
    shop exported twelve sarees and a potli with no product type, each tagged
    with the shelf it plainly belongs on; with no shelf they were findable by
    search and invisible to a visitor choosing a category.

    And a shelf that is a combination is folded into a simple one — see
    `simple_shelf`.

    The shelves in play are the ones in this batch, plus `also` — the org's
    existing shelves, for an upsert that adds to them. A mirror replaces the
    whole catalog, so its batch is all there is; `sync.pull_catalog` runs its
    incoming rows through this before comparing them with what is on disk, or
    a catalog that was filed here would never again look unchanged.
    """
    known = _known_shelves([*(also or []), *(p.category for p in products)])
    out = []
    for product in products:
        shelf, attributes = _filed(product.category, product.attributes, known)
        changed = shelf != product.category or attributes is not product.attributes
        out.append(
            Product(**{**asdict(product), "category": shelf, "attributes": attributes})
            if changed
            else product
        )
    return out


#: A shelf speaks for its unlabelled pieces when at least this many of its pieces
#: say who they are for, and this share of those agree.
_SHELF_SPEAKS_FROM = 5
_SHELF_AGREES = 0.95


def _settle_departments(
    conn: sqlite3.Connection, org_id: str, only: set[str] | None = None
) -> None:
    """Give a piece that says nothing about who it is for its shelf's answer.

    Three of this shop's largest suppliers tag a kurta set "Kurta Sets, Casual
    Wear" and never "Women", and the name does not say either. Of its first
    20,000 products 4,646 had no department — so they were on neither rail, and
    the Women's wear tiles counted a fraction of the women's wear. The shelf
    knows: all 4,609 labelled Kurta Sets are women's.

    So a shelf with enough labelled pieces, nearly all agreeing, answers for the
    rest of it. A shelf that is genuinely mixed does not: this shop's Kurtas are
    705 women's to 39 men's, 94.8%, and its 47 unlabelled kurtas stay
    unlabelled rather than being guessed onto the wrong rail.

    Counted from each row's *own* label every time, never from what is stored.
    A stored department may itself be an inference from an earlier run, and a
    shelf that counted its inferences as evidence would vote itself into a
    department. For the same reason an inference is taken back when the shelf
    stops being one-sided.

    `only` is the shelves a write touched; the whole org when the catalog is
    replaced or first brought up to date.
    """
    query = (
        "SELECT id, name, category, attributes, IFNULL(department, '') AS department "
        "FROM products WHERE org_id = ? AND IFNULL(category, '') != ''"
    )
    args: list[Any] = [org_id]
    if only is not None:
        only = {shelf for shelf in only if shelf and shelf.strip()}
        # SQLite binds at most 999 values; a write touching more shelves than
        # that is a whole catalog, and is settled as one.
        if not only:
            return
        if len(only) <= 900:
            query += f" AND category IN ({', '.join('?' * len(only))})"
            args += sorted(only)

    # Grouped by what the shop listed each piece as, not by the shelf it is
    # filed on. Folding "Kurta And Pyjama Sets" into Kurta Sets put 1,174 men's
    # sets beside 7,631 women's, and a shelf that reads 87% women's answers for
    # nobody — so 2,600 unlabelled women's kurta sets lost their department.
    # What the shop called plain "Kurta Sets" is still women's to the last one.
    shelves_: dict[str, list[tuple[str, str, str]]] = {}
    for row in conn.execute(query, args).fetchall():
        try:
            attributes = json.loads(row["attributes"] or "{}")
        except (TypeError, ValueError):
            attributes = {}
        own = department_of(row["name"] or "", row["category"], attributes)
        shelves_.setdefault(listed_as(row["category"], attributes), []).append(
            (row["id"], own, row["department"])
        )

    updates = []
    for pieces in shelves_.values():
        men = sum(1 for _, own, _ in pieces if own == MEN)
        women = sum(1 for _, own, _ in pieces if own == WOMEN)
        labelled = men + women
        agreed = ""
        if labelled >= _SHELF_SPEAKS_FROM and max(men, women) / labelled >= _SHELF_AGREES:
            agreed = MEN if men > women else WOMEN
        updates += [
            (agreed, org_id, pid) for pid, own, stored in pieces if own == "" and stored != agreed
        ]
    conn.executemany("UPDATE products SET department = ? WHERE org_id = ? AND id = ?", updates)


def upsert(products: list[Product], org_id: str = DEFAULT_ORG) -> int:
    init()
    products = shelved(products, categories(org_id))
    with _connect() as conn:
        conn.executemany(_UPSERT_SQL, _bind(products, org_id))
        _settle_departments(conn, org_id, {p.category for p in products})
    return len(products)


def replace(products: list[Product], org_id: str = DEFAULT_ORG) -> int:
    """Make one org's catalog exactly this list, in a single transaction.

    `upsert` cannot express a deletion — it is how a cabinet learns about new
    products and never how it learns that 4,750 of them are gone. Mirroring the
    platform needs both, and needs them atomic: a clear that commits followed by
    an insert that fails is a showroom whose avatar has nothing to sell, in the
    window between two statements.

    The connection is the transaction. Both statements land or neither does.

    Refusing an empty list is not a convenience, it is the guard that matters:
    the caller is a sync loop reading somebody else's HTTP response, and the
    difference between "this org has no products" and "the request came back
    empty" is invisible from here. Wiping a live catalog on a bad response is
    the one failure this whole feature could introduce, so an empty replace is
    refused and the caller keeps what it had.
    """
    if not products:
        return 0
    init()
    products = shelved(products)
    with _connect() as conn:
        conn.execute("DELETE FROM products WHERE org_id = ?", (org_id,))
        conn.executemany(_UPSERT_SQL, _bind(products, org_id))
        _settle_departments(conn, org_id)
    return len(products)


def all_products(org_id: str = DEFAULT_ORG) -> list[Product]:
    init()
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM products WHERE org_id = ? ORDER BY name", (org_id,)
        ).fetchall()
    return [_row_to_product(r) for r in rows]


def browse(
    org_id: str = DEFAULT_ORG,
    department: str | None = None,
    category: str | None = None,
    q: str = "",
    limit: int = 200,
    offset: int = 0,
) -> tuple[int, list[dict]]:
    """One page of an org's catalog as it is filed, and how many match in all.

    For the studio's Products tab, which used to fetch the whole catalog and
    filter it in the browser: 46 MB at 25,000 products, on every visit. Filtered
    and counted here, a page is the 200 rows that are drawn.

    `None` is "any"; an empty string is a real answer — the pieces placed in no
    department, or filed on no shelf. Each row is `to_dict` plus the department
    it was filed under, which `Product` deliberately does not carry: a cabinet
    mirrors products, and what one is filed as is this install's own reading.
    """
    init()
    clauses, params = ["org_id = ?"], [org_id]
    if department is not None:
        clauses.append("IFNULL(department, '') = ?")
        params.append(department)
    if category is not None:
        clauses.append("IFNULL(category, '') = ?")
        params.append(category)
    needle = q.strip()
    if needle:
        # Typed by a person, so `%` and `_` are characters, not wildcards.
        like = "%" + re.sub(r"([\\%_])", r"\\\1", needle) + "%"
        clauses.append(
            "(name LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\')"
        )
        params += [like, like, like]
    where = " AND ".join(clauses)
    with _connect() as conn:
        total = conn.execute(f"SELECT COUNT(*) FROM products WHERE {where}", params).fetchone()[0]
        rows = conn.execute(
            f"SELECT * FROM products WHERE {where} ORDER BY name LIMIT ? OFFSET ?",
            [*params, limit, offset],
        ).fetchall()
    return total, [
        {**to_dict(_row_to_product(r)), "department": r["department"] or ""} for r in rows
    ]


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


#: What customers call things, where it differs from what the supplier called
#: them. Not a thesaurus — every entry here is a spelling a person actually uses
#: for a category this catalog actually has.
#:
#: "Sari" is the entry that matters. It is the standard English spelling, the
#: shop files it as "Sarees", and keyword search across five thousand rows
#: returned nothing at all for it — so a customer asking for the single largest
#: category in the shop was told we do not carry them. Fuzzy matching alone does
#: not reach it: "sari" to "sarees" scores below the threshold that keeps
#: "laptop" from matching, and a false match is far worse than a miss.
CATEGORY_ALIASES = {
    "sari": "Sarees",
    "saris": "Sarees",
    "saree": "Sarees",
    "sarees": "Sarees",
    "lehnga": "Lehengas",
    "lehanga": "Lehengas",
    "lehenga": "Lehengas",
    "ghagra": "Lehengas",
    "kurti": "Kurtas",
    "kurtis": "Kurtas",
    "kurta": "Kurtas",
    "salwar": "Kurta Sets",
    # "suit" is deliberately absent. Now that a named category filters every
    # search rather than only rescuing a miss, "does this suit me?" would have
    # swapped the sarees on screen for kurta sets mid-sentence.
    "dupatta": "Dupattas",
    "chunni": "Dupattas",
    "blouse": "Blouses",
    "bangle": "Bangles",
    "bracelet": "Bangles",
    "earring": "Earrings",
    "jhumka": "Earrings",
    "jhumkas": "Earrings",
    "rakhi": "Rakhis",
    "bag": "Ethnic Bags",
    "potli": "Ethnic Bags",
    "palazzo": "Palazzos",
    "sharara": "Shararas",
    # "men", "mens", "gents", "menswear" and "jewellery" are not here any more.
    # They were — pointing at Men's Kurtas and Jewellery Sets — and a word for a
    # whole department opened one shelf of it. They are `DEPARTMENT_WORDS` now.
    #
    # How Whisper writes these shelves, from the event log — each one a visitor
    # asking for something we stock and being told we do not carry it.
    "curtis": "Kurtas",
    "curtas": "Kurtas",
    "courtes": "Kurtas",
    "saddies": "Sarees",
    "sadies": "Sarees",
    "handbag": "Ethnic Bags",
    "handbags": "Ethnic Bags",
}

#: How close a word must be to a category name before we treat it as that
#: category. 0.7 because 0.6 matched "laptop" to a clothing category, and an
#: avatar that answers "do you have a laptop" with sarees is worse than one that
#: says no — this project spent months on making refusals hold.
_CATEGORY_CUTOFF = 0.7


def _closest(word: str, known: list[str]) -> str:
    """The nearest category name to a word, or "" — first letter required to agree.

    difflib scores on characters shared anywhere in the string, which on short
    words lets ordinary English rhyme its way onto a shelf. Both of these clear
    the cutoff at 0.727: "laptops" against "Tops", and "things" against "Rings".
    So "show me laptops" filled the panel with linen tops while the avatar was
    saying out loud that we do not sell laptops, and "what kind of things do you
    have" answered with three rings.

    A typo or a mishearing almost never moves the first letter — "lehnga",
    "earing", "dupata", "palazo" all keep theirs. A word that merely rhymes
    usually does not. That single condition removes every collision this catalog
    has without costing a real match, which raising the cutoff does not do as
    reliably: the next rhyme along will sit above whatever number is chosen.
    """
    match = difflib.get_close_matches(word, known, n=1, cutoff=_CATEGORY_CUTOFF)
    return match[0] if match and match[0][:1] == word[:1] else ""


def resolve_category(text: str, org_id: str = DEFAULT_ORG) -> str:
    """The category someone meant, or "" if nothing is close enough.

    Aliases first, because they are exact and deliberate. Then difflib, which
    covers plurals, typos and the transcription errors a microphone in a mall
    will produce — "kurta" for "Kurtas", "ear rings" for "Earrings".

    Only ever consulted after a search has already found nothing, so it can
    never override a real result, and matched against the categories this org
    actually stocks rather than a fixed list.
    """
    known = {c.lower(): c for c in categories(org_id) if c.strip()}
    if not known:
        return ""

    words = [w for w in re.findall(r"[a-z]+", text.lower()) if w not in STOPWORDS]
    for word in words:
        hit = _aliased(word, known)
        if hit:
            return hit

    for word in words:
        match = _closest(word, list(known))
        if match:
            return known[match]
    return ""


def parse_category(text: str, org_id: str = DEFAULT_ORG) -> tuple[str, str]:
    """Lift the shelf out of the sentence, the way `parse_facets` lifts a colour.

    "Show me kurta sets" returned eight products in eight different categories,
    one of them a kurta set. The words matched a co-ord, a dupatta and a dress
    whose copy mentions a kurta, and the one-per-category thinning that makes a
    browse look like a showroom then made a shelf look like a jumble. The
    visitor named a category; the category has to be the filter, not a hint.

    Returns the text with the category's words removed, so what is left is the
    part FTS should rank on — "for gaming" from "laptop for gaming" — and an
    empty remainder means the shelf, unranked.
    """
    known = {c.lower(): c for c in categories(org_id) if c.strip()}
    if not known:
        return text, ""
    words = re.findall(r"[a-z]+", text.lower())

    def lift(hit: str, said: set[str]) -> tuple[str, str]:
        # Every word of the shelf goes, not just the one that matched. Leaving
        # "sets" behind after lifting "Kurta Sets" ranks a jewellery set against
        # the kurta sets somebody asked for.
        gone = said | set(hit.lower().split())
        kept = [w for w in text.split() if re.sub(r"[^a-z]", "", w.lower()) not in gone]
        return " ".join(kept), hit

    # Pairs before singles, because a longer phrase is a more specific request
    # and this catalog is full of two-word shelves — "Kurta Sets", "Jewellery
    # Sets", "Ethnic Bags". Matching "kurta" alone sent someone asking for a
    # kurta set to the kurtas, which is a different rail in a real shop.
    for a, b in zip(words, words[1:]):
        # Both halves have to carry meaning. "the laptops" scores 0.78 against
        # "Laptops" on its own, so a pair holding a function word matched — and
        # lifted "the" out of the sentence with it.
        if a in STOPWORDS or b in STOPWORDS:
            continue
        phrase = f"{a} {b}"
        if phrase in known:
            return lift(known[phrase], {a, b})
        match = _closest(phrase, list(known))
        if match:
            return lift(known[match], {a, b})

    for word in words:
        if word in STOPWORDS:
            continue
        hit = _aliased(word, known)
        if not hit:
            match = _closest(word, list(known))
            hit = known[match] if match else None
        if hit:
            return lift(hit, {word})
    return text, ""


def _aliased(word: str, known: dict[str, str]) -> str:
    """The shelf a word names outright or by alias, or "" — before any fuzzy
    match is tried.

    A shelf's own name comes first, singular or plural. "Bracelet" is listed
    as an alias for Bangles, which is right for a shop with no Bracelets shelf
    and wrong for one that has it.

    Then the alias, and the alias of the word's singular. Only "bag" was
    listed, so "show me bags" fell through to the fuzzy match — where "bags"
    is 0.73 against "bangles" — and a visitor asking for bags was shown bangles.
    """
    for shelf in known:
        if _stem(shelf) == _stem(word):
            return known[shelf]
    for form in (word, _stem(word)):
        target = CATEGORY_ALIASES.get(form, "")
        if target and target.lower() in known:
            return known[target.lower()]
    return ""


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
#: Words that are never merchandise, so they never belong in a search — or in
#: the grounding guard's judgement of what a visitor asked for.
#:
#: This is not a generic English stopword list — it is the words a person uses
#: to *ask* in a clothing showroom, and every one of them appears somewhere in
#: marketing copy. Because `_fts_query` ORs its terms, a single incidental hit
#: on one of them returns a product, and the panel then contradicts the answer
#: being spoken over it. Measured, not guessed:
#:
#:   "What are your opening hours?"  matched a garment on "hours"
#:   "Help me choose something."     matched three on "help" and "choose"
#:   "I want to buy a mobile phone"  matched a belt on "buy separately"
#:   "what kind of things do you have"  matched a jacket on "small things"
#:
#: Two of those four are the kiosk's own prompt chips. Words that could ever be
#: a thing somebody shops for stay out: "party" and "wedding" are occasions,
#: "new" is a real question about stock, "gold" is a colour.
#:
#: The last group is the words a follow-up is made of — "what is it made of",
#: "how much is the first one", "anything cheaper". None of them is a thing on a
#: rail, and each was searching: "made" put a shawl and two shararas in front of
#: somebody asking what their saree was woven from.
#:
#: The last two lines are chatter from the event log that was pulling products
#: up — "Hello, good morning", "Nice to meet you", "Listen", "One more" — and
#: "Does this come in other colours?", which swapped the saree being discussed
#: for three co-ords whose copy said "comes in two colours". A named colour is
#: still a filter: `parse_facets` lifts "red" before these words are read.
#:
#: The group before it is the shop's own vocabulary for itself — "category", "range",
#: "clothing", "wear". They are never a thing on a rail, and `ungrounded_claim`
#: reads this list too: without them "what categories do you have" was answered
#: with a refusal, because the reply repeated the visitor's word "categories"
#: and no shelf is called that.
STOPWORDS = frozenset("""
a an and any are as at be but by can could do does for from get give got has have
he her him his they them their how i if in is it its like looking me my need of on or our out
please see she show some something that the their them then there these they this
those to us want was we what when where which who will with would you your
about all another available buy buying carry choose does doing hello help here hey
hi hours just kind kinds know many morning much nice one ones opening other really
sell selling sells stock tell thank thanks thing things today very
ain aren couldn didn doesn don hadn hasn haven isn mustn needn shan shouldn wasn
weren won wouldn
apparel categories category clothes clothing collection collections fashion item
items option options product products range ranges section sections selection
selections stuff type types wear
anything anyone best better cheap cheaper cheapest cost costs everything
expensive first fifth fourth last less made next previous price priced prices
second third
good meet listen more welcome well yeah okay right sure maybe
come comes colour colours color colors
""".split())


def _fts_query(text: str) -> str:
    """Turn what a person said into something FTS5 will accept.

    Visitors speak in sentences, and raw punctuation is a syntax error in FTS5.
    Meaningful words are OR-ed together so a partial phrase still returns its best
    matches rather than nothing.

    Splitting on non-alphanumerics cuts contractions in half, and the front half
    is a word nobody said: "isn't" becomes "isn", which is three characters long,
    is in no stopword list, and matched "Dressing up isn't a hassle" in a product
    description. So "nice weather today isn't it" put a pair of harem pants on
    the panel. The `n't` stems are a closed set and sit in STOPWORDS with the
    rest; the other halves — "ll", "ve", "re", "t", "s" — are already too short
    to survive.
    """
    words = [w.lower() for w in "".join(c if c.isalnum() else " " for c in text).split()]
    kept = [w for w in words if w not in STOPWORDS and len(w) > 2]

    # Prefix matching only from four characters. "car*" would hit "cardigan" and
    # "carton"; "lapt*" only ever means laptop.
    return " OR ".join(f"{w}*" if len(w) > 3 else w for w in kept)


def _fts_terms(text: str) -> list[str]:
    """The words of a query that FTS will actually search on."""
    words = [w.lower() for w in "".join(c if c.isalnum() else " " for c in text).split()]
    return [w for w in words if w not in STOPWORDS and len(w) > 2]


def _corroborated(terms: list[str], found: list[Product]) -> list[Product]:
    """Drop rows that match only one of several things the visitor said.

    `_fts_query` ORs its terms, so one incidental hit anywhere in a product's
    copy is enough to return it. That is right for a single word — somebody who
    says "party" means the pieces whose description says party — and wrong the
    moment they say two. Asked for a "mobile phone", this shop offered a potli
    and a jacket: neither is a phone, both blurbs happen to mention keeping your
    phone in them, and each matched exactly one term out of two.

    So a row has to corroborate: with two or more terms in play it must carry at
    least two of them. Nothing is required of a single-term query, because there
    is no second word to agree with.

    Facets and shelves are lifted out before this, so by here the terms really
    are two separate nouns rather than a colour and its garment.
    """
    if len(terms) < 2:
        return found
    kept = []
    for product in found:
        haystack = " ".join(
            [product.name, product.category, product.description or ""]
        ).lower()
        if sum(1 for t in terms if t in haystack) >= 2:
            kept.append(product)
    return kept


#: The words a visitor names a department with. Whisper writes "men's" with and
#: without its apostrophe and "menswear" as one word, so they are read with
#: everything but letters taken out.
#:
#: These used to be shelf aliases — "menswear" meant the Men's Kurtas shelf and
#: "jewellery" meant Jewellery Sets — which is how a shop with men's kurtas,
#: pyjamas and pants answered "men's wear" with kurtas and nothing else.
DEPARTMENT_WORDS = {
    "men": MEN, "mens": MEN, "gents": MEN, "menswear": MEN, "male": MEN,
    "women": WOMEN, "womens": WOMEN, "ladies": WOMEN, "womenswear": WOMEN, "female": WOMEN,
    "jewellery": JEWELLERY, "jewelry": JEWELLERY, "jewelery": JEWELLERY, "jewelries": JEWELLERY,
    "accessories": ACCESSORIES, "accessory": ACCESSORIES,
}


def parse_department(text: str) -> tuple[str, str]:
    """Lift the department out of a sentence, as `parse_facets` lifts a colour.

    Returns the text without the department's words and "men", "women",
    "accessories" or "". Two different departments in one breath ("for men and
    women") is not a choice of either, so nothing is lifted.
    """
    kept, named = [], set()
    for token in text.split():
        department = DEPARTMENT_WORDS.get(re.sub(r"[^a-z]", "", token.lower()))
        if department:
            named.add(department)
        else:
            kept.append(token)
    if len(named) != 1:
        return text, ""
    return " ".join(kept), named.pop()


def shelves(org_id: str = DEFAULT_ORG, department: str = "") -> list[dict]:
    """The shelves of one department, fullest first — the tiles a visitor picks
    from, each with a count and one picture to stand for it.

    Counts are of this department's rows only: this shop's Pants shelf holds two
    women's pieces and one men's, and the men's tile has to say one.
    """
    init()
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT p.category AS category, COUNT(*) AS count,
                   (SELECT q.image FROM products q
                     WHERE q.org_id = p.org_id AND q.category = p.category
                       AND IFNULL(q.department, '') = IFNULL(p.department, '')
                       AND IFNULL(q.image, '') != ''
                     ORDER BY q.name LIMIT 1) AS image
              FROM products p
             WHERE p.org_id = ? AND IFNULL(p.department, '') = ? AND IFNULL(p.category, '') != ''
             GROUP BY p.category
             ORDER BY count DESC, p.category
            """,
            (org_id, department),
        ).fetchall()
    return [{"category": r["category"], "count": r["count"], "image": r["image"] or ""} for r in rows]


def tiles(org_id: str = DEFAULT_ORG, department: str = "") -> list[dict]:
    """What the panel offers for a department: its shelves — and, under
    Jewellery, one last tile that leads on to the accessories.

    A visitor reaches both from the one Jewellery chip, so the accessories have
    to be reachable from there; and they are not jewellery, so they are not
    among its tiles. That last tile carries `opens`, the department it leads
    to, and stands for all of it: the count is every accessory, the picture is
    its fullest shelf's.
    """
    found = shelves(org_id, department)
    if department == JEWELLERY:
        beyond = shelves(org_id, ACCESSORIES)
        if beyond:
            found.append({
                "category": DEPARTMENT_LABELS[ACCESSORIES],
                "count": sum(shelf["count"] for shelf in beyond),
                "image": beyond[0]["image"],
                "opens": ACCESSORIES,
            })
    return found


def shelf_in(department: str, text: str, org_id: str = DEFAULT_ORG) -> str:
    """The shelf of this department a sentence names, or "".

    Matched word by word against the department's own shelves, not by
    `parse_category` against all of them. "Men's kurtas" has to reach the Men's
    Kurtas shelf: as a whole phrase "kurtas" scores 0.67 against it, under the
    cutoff, while it matches the women's Kurtas shelf exactly — and that shelf
    has nothing for a man on it.

    A shelf is named when every word of it has been said, the department's own
    words aside ("men's" in Men's Kurtas, "jewellery" in Jewellery Sets). The
    longest such shelf wins, so "kurta sets" is not answered with Kurtas.
    """
    words = [w for w in re.findall(r"[a-z]+", text.lower()) if w not in STOPWORDS]
    rails = [
        (
            shelf["category"],
            [
                _stem(w)
                for w in re.findall(r"[a-z]+", shelf["category"].lower())
                if len(w) > 2 and w not in DEPARTMENT_WORDS
            ],
        )
        for shelf in shelves(org_id, department)
    ]

    def named(said: set[str]) -> str:
        best, most = "", 0
        for shelf, needed in rails:
            if needed and len(needed) > most and all(
                w in said or _closest(w, list(said)) for w in needed
            ):
                best, most = shelf, len(needed)
        return best

    # What was said, as said — and only if that names nothing, as its aliases
    # spell it: "curtas" -> Kurtas, "bags" -> Ethnic Bags by its singular. In
    # that order for the reason `_aliased` gives: "bracelet" is an alias for
    # Bangles, and must not beat a Bracelets shelf that is right there.
    own = {_stem(w) for w in words}
    aliases = {
        _stem(spelling)
        for w in words
        for spelling in re.findall(
            r"[a-z]+",
            (CATEGORY_ALIASES.get(w) or CATEGORY_ALIASES.get(_stem(w)) or "").lower(),
        )
    }
    return named(own) or named(own | aliases)


def _stem(word: str) -> str:
    """Crude singular, so "kurta" and "kurtas" compare equal."""
    return word[:-1] if len(word) > 3 and word.endswith("s") else word


def search(
    query: str = "",
    category: str = "",
    max_price: float | None = None,
    limit: int = 8,
    org_id: str = DEFAULT_ORG,
    per_category: bool = True,
    color: str = "",
    style: str = "",
    department: str = "",
) -> list[Product]:
    """Find products. Everything is optional — an empty query with a category is
    "show me your laptops", and an empty everything is "show me what you have".

    `org_id` is not optional in effect: it is always applied. This is the query
    that feeds the model, so a missing tenant filter would not be a leak in a
    dashboard — it would be one company's avatar quoting another company's prices
    out loud to a customer.
    """
    init()

    # "Menswear", "for ladies", "jewellery": a rail, lifted before the shelf is.
    if not department:
        query, department = parse_department(query)

    # A category named in the sentence is a filter, applied before anything is
    # ranked. This used to run only as a fallback on a miss — so "show me sarees"
    # keyword-matched a blouse and an accessory whose copy says "saree", never
    # reached the fallback, and the thinning below returned one of each. The
    # visitor said which shelf; ranking other shelves against it is not a
    # search, it is a guess with a confident face.
    lifted = False
    if query.strip() and not category:
        if department:
            # Among that department's shelves only — see `shelf_in`. The shelf's
            # own words are then spent: "women's dresses" must not go on to
            # require the word "dresses" of products named "… Midi Dress".
            category = shelf_in(department, query, org_id)
            if category:
                query = ""
        else:
            query, category = parse_category(query, org_id)
        lifted = bool(category)

    # Always present, always first. A tenant filter that is one branch among
    # several is a tenant filter that a later edit can drop.
    clauses: list[str] = ["p.org_id = ?"]
    params: list[Any] = [org_id]
    joined = "products p"
    order = "p.name"

    if query.strip():
        expression = _fts_query(query)
        if expression:
            joined = "products_fts f JOIN products p ON p.rowid = f.rowid"
            clauses.append("products_fts MATCH ?")
            params.append(expression)
            # bm25 favours rarer terms, so a specific model name beats a generic
            # category word — which is what someone naming a product expects.
            order = "bm25(products_fts)"
        elif not (category or color or style or department or max_price is not None):
            # Somebody said something, and none of it was about merchandise.
            #
            # An empty `query` means "show me what you have" and browses the
            # catalog, which is right. A query that is *not* empty but whose
            # every word is a stopword is a different thing entirely — and it
            # was taking the same path, because the only test was whether an
            # FTS expression came out. So "hi there how are you" put eight
            # unrelated products on the panel, and every greeting a visitor
            # opened with was answered by the merchandise wall the thinning
            # exists to prevent.
            #
            # Nothing to search for is not the same as nothing to search by.
            return []

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
    #
    # So is an occasion, and it was missing from this list. Every one of this
    # shop's twenty wedding pieces is a lehenga, so "something for a wedding"
    # narrowed correctly to twenty and then thinned to *one* — the thinning that
    # stops a browse looking like a warehouse was emptying the one rail somebody
    # had actually asked to see.
    thin = per_category and not category and not color and not style

    def fetch(only: str = "") -> list[sqlite3.Row]:
        where = " AND ".join(clauses + ([only] if only else []))
        sql = f"SELECT p.* FROM {joined} WHERE {where} ORDER BY {order} LIMIT ?"
        # Over-fetch, then thin. The thinning below keeps one row per category,
        # so asking the database for `limit` rows would return one category's
        # worth of near-duplicates and thin them to a single product.
        with _connect() as conn:
            return conn.execute(sql, [*params, limit * FAN_OUT if thin else limit]).fetchall()

    # Garments and jewellery are never one list. "What is new" put a nose ring
    # between a saree and a kurta, and "something in gold" was half bangles: a
    # visitor looking at clothes is not helped by what is not clothes, and the
    # other way round. A named shelf or department has already chosen; anything
    # else is one kind or the other, decided here.
    listed = ", ".join(f"'{d}'" for d in EXTRAS)
    garments = f"IFNULL(p.department, '') NOT IN ({listed})"
    extras = f"IFNULL(p.department, '') IN ({listed})"
    if department:
        clauses.append("IFNULL(p.department, '') = ?")
        params.append(department)
        rows = fetch()
    elif category:
        rows = fetch()
    elif order == "p.name":
        # Nothing to rank by — a browse, or a colour on its own. Clothes are
        # what a clothes shop shows first; the rest only if there are none.
        rows = fetch(garments) or fetch(extras)
    else:
        # Ranked: the best match says which kind was meant. "Necklace" must not
        # lose to a kurta set whose blurb mentions one.
        rows = fetch()
        kinds = {(r["department"] or "") in EXTRAS for r in rows}
        if len(kinds) > 1:
            rows = fetch(extras if (rows[0]["department"] or "") in EXTRAS else garments)
    found = _corroborated(_fts_terms(query), [_row_to_product(r) for r in rows])

    # The words left over after lifting a shelf are a ranking hint, not a second
    # filter. "What's the best laptop?" leaves "best", which appears in no
    # laptop's copy — so ANDing it against the category returned nothing at all
    # for a question about a shelf we stock. Fall back to the shelf itself.
    if not found and lifted and query.strip():
        return search(
            "",
            category,
            max_price,
            limit,
            org_id,
            per_category=False,
            color=color,
            style=style,
            department=department,
        )

    # Nothing matched, and the words might still name something we stock. A
    # customer says "sari", the shop files it as "Sarees", and FTS matches
    # neither to the other — so the largest category in the shop answered "we do
    # not carry those". Only runs on a miss, so it cannot override a real result,
    # and only when the caller named no category of its own.
    if not found and query.strip() and not category:
        guess = resolve_category(query, org_id)
        if guess:
            return search(
                "",
                guess,
                max_price,
                limit,
                org_id,
                per_category=False,
                color=color,
                style=style,
                department=department,
            )

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
