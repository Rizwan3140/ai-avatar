"""Turn whatever a company hands over into something the avatar can answer from.

    python -m backend.ingest path/to/your-catalog.csv
    python -m backend.ingest returns-policy.pdf brochure.docx

A company will hand over whatever their system exports, with whatever column
names it happened to use. Refusing anything that is not exactly our schema puts
a data-cleaning job between a customer and their first demo, so headers are
matched by meaning and everything unrecognised is kept as an attribute rather
than discarded.

Unknown columns become attributes on purpose. A fashion export has "size" and
"fabric", an electronics one has "RAM" and "screen", and both are searchable
without anyone declaring them first.

**Two destinations, decided by shape rather than by extension.** Anything with
rows and headers — a CSV, a JSON array, a table inside a Word document — is a
catalog and becomes products. Anything that is prose — a returns policy, a
warranty page, a brochure — becomes passages in `documents.py`, because "do you
deliver to Pune" is a question no product row can answer.

DOCX is read with `zipfile` and `xml.etree`: a .docx *is* a zip of XML, and a
library for that would be a dependency to avoid learning twelve lines. PDF is not
that kind of format and uses `pypdf`.

A PDF's *tables* are deliberately not mined for products. Recovering columns from
glyph positions is guesswork, and a price silently attached to the wrong product
is the single worst failure this system has — worse than not importing at all,
because nobody checks what looked like it worked. Prose from a PDF, yes; a
catalog from a PDF, export a CSV.
"""

import csv
import io
import json
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree

from backend import documents

ROOT = Path(__file__).resolve().parent.parent
from backend.catalog import DEFAULT_ORG, Product, upsert


class UnsupportedFile(Exception):
    """A format we cannot read. Says so rather than importing nothing quietly."""

# Header synonyms, by meaning. Extend from real customer files, not from guesses.
ALIASES = {
    "id": ("id", "product_id", "sku", "code", "item_id", "handle"),
    "name": ("name", "title", "product", "product_name", "item"),
    "category": ("category", "type", "product_type", "collection", "department"),
    "price": ("price", "mrp", "cost", "amount", "selling_price", "rate"),
    "currency": ("currency", "curr"),
    "description": ("description", "desc", "details", "summary", "about", "body"),
    "url": ("url", "link", "product_url", "page", "permalink"),
    "image": ("image", "image_url", "img", "photo", "picture", "thumbnail"),
    "availability": ("availability", "stock", "in_stock", "status", "inventory"),
}

_LOOKUP = {alias: field for field, aliases in ALIASES.items() for alias in aliases}

#: Where csv.DictReader puts fields beyond the header — i.e. unquoted commas.
OVERFLOW = "__overflow__"


def _normalise(header: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", header.strip().lower()).strip("_")


def _price(value: str) -> float | None:
    """Prices arrive as "₹12,990", "12990.00", "Rs. 12990" or blank."""
    digits = re.sub(r"[^0-9.]", "", value or "")
    try:
        return float(digits) if digits else None
    except ValueError:
        return None


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:60]


def from_rows(rows: list[dict]) -> list[Product]:
    products: list[Product] = []

    for index, raw in enumerate(rows):
        mapped: dict[str, str] = {}
        attributes: dict[str, str] = {}

        for header, value in raw.items():
            if header is None or value is None or str(value).strip() == "":
                continue
            field = _LOOKUP.get(_normalise(header))
            if field:
                mapped[field] = str(value).strip()
            else:
                # Keep it. This is what makes the schema work for fashion and
                # hotels without a migration.
                attributes[_normalise(header)] = str(value).strip()

        name = mapped.get("name", "")
        if not name:
            continue  # A product without a name cannot be shown or spoken about.

        products.append(
            Product(
                id=mapped.get("id") or slug(name) or f"item-{index}",
                name=name,
                category=mapped.get("category", ""),
                price=_price(mapped.get("price", "")),
                currency=mapped.get("currency", "INR"),
                description=mapped.get("description", ""),
                url=mapped.get("url", ""),
                image=mapped.get("image", ""),
                availability=mapped.get("availability", "in_stock"),
                attributes=attributes,
            )
        )

    return products


def from_csv(text: str) -> list[dict]:
    # csv.Sniffer guesses the delimiter, because exports arrive comma-, semicolon-
    # and tab-separated depending on the locale the spreadsheet was saved in.
    try:
        dialect = csv.Sniffer().sniff(text[:2048], delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel

    reader = csv.DictReader(text.splitlines(), dialect=dialect, restkey=OVERFLOW)
    fields = reader.fieldnames or []
    last = fields[-1] if fields else ""

    rows = []
    for row in reader:
        # Hand-written exports routinely leave a free-text final column unquoted,
        # so "...power delivery, ideal for a clean desk" splits into extra fields
        # and the tail is silently lost. Sew it back onto the last real column —
        # a truncated description is a product the avatar cannot describe.
        extra = row.pop(OVERFLOW, None)
        if extra and last:
            row[last] = ", ".join(filter(None, [row.get(last), *extra]))
        rows.append(row)
    return rows


# --- Word ---------------------------------------------------------------------
# A .docx is a zip holding word/document.xml. Everything below is that file:
# w:tbl is a table, w:tr a row, w:tc a cell, w:p a paragraph, w:t a run of text.

_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def _docx_text(node: ElementTree.Element) -> str:
    """All the text under a node, with tabs and breaks kept as spaces.

    Word splits a single word across several <w:t> runs whenever formatting
    changes mid-word, so joining with a space would turn "Titan Pro" into
    "T itan Pro". Runs join bare; only explicit breaks become whitespace.
    """
    parts: list[str] = []
    for child in node.iter():
        tag = child.tag
        if tag == f"{_W}t":
            parts.append(child.text or "")
        elif tag in (f"{_W}tab", f"{_W}br", f"{_W}cr"):
            parts.append(" ")
        elif tag == f"{_W}p" and parts:
            parts.append("\n")
    return "".join(parts).strip()


def read_docx(data: bytes) -> tuple[list[dict], str]:
    """(table rows, prose). A document can legitimately have both — a brochure
    with a spec table and three paragraphs about the brand."""
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
        xml = archive.read("word/document.xml")
    except (zipfile.BadZipFile, KeyError) as exc:
        raise UnsupportedFile("that .docx could not be opened — is it really a Word file?") from exc

    body = ElementTree.fromstring(xml)
    rows: list[dict] = []
    prose: list[str] = []

    for table in body.iter(f"{_W}tbl"):
        cells = [
            [_docx_text(tc) for tc in tr.findall(f"{_W}tc")]
            for tr in table.findall(f"{_W}tr")
        ]
        # One row is a header with nothing under it; two columns or fewer is a
        # layout table, not data. Both are common and neither is a catalog.
        if len(cells) < 2 or len(cells[0]) < 2:
            prose.extend(" | ".join(row) for row in cells)
            continue
        header = cells[0]
        rows.extend(
            dict(zip(header, row)) for row in cells[1:] if any(v.strip() for v in row)
        )

    in_table = {id(node) for table in body.iter(f"{_W}tbl") for node in table.iter()}
    for paragraph in body.iter(f"{_W}p"):
        if id(paragraph) in in_table:
            continue  # Already accounted for as a table cell.
        text = _docx_text(paragraph)
        if text:
            prose.append(text)

    return rows, "\n\n".join(prose)


def read_pdf(data: bytes) -> str:
    try:
        from pypdf import PdfReader
    except ImportError as exc:
        raise UnsupportedFile(
            "PDF ingest needs pypdf — pip install -r requirements.txt"
        ) from exc

    reader = PdfReader(io.BytesIO(data))
    pages = [page.extract_text() or "" for page in reader.pages]
    text = "\n\n".join(p.strip() for p in pages if p.strip())
    if not text:
        raise UnsupportedFile(
            "no text in that PDF — it is probably a scan, which needs OCR we do not do"
        )
    return text


# --- dispatch -----------------------------------------------------------------


def from_bytes(data: bytes, filename: str) -> tuple[list[Product], str]:
    """(products, prose) for any supported file. The caller decides where each goes."""
    suffix = Path(filename).suffix.lower()

    if suffix in (".csv", ".tsv", ".txt") or suffix == "":
        text = data.decode("utf-8-sig", errors="replace")
        # A .txt with a header row is a catalog someone renamed; a .txt without
        # one is a policy. Sniffing beats trusting the extension.
        rows = from_csv(text) if suffix != ".txt" or _looks_tabular(text) else []
        return (from_rows(rows), "" if rows else text)

    if suffix == ".json":
        payload = json.loads(data.decode("utf-8-sig"))
        rows = payload if isinstance(payload, list) else payload.get("products", [])
        return from_rows(rows), ""

    if suffix in (".md", ".markdown"):
        return [], data.decode("utf-8-sig", errors="replace")

    if suffix == ".docx":
        rows, prose = read_docx(data)
        return from_rows(rows), prose

    if suffix == ".pdf":
        return [], read_pdf(data)

    raise UnsupportedFile(
        f"cannot read {suffix or filename} — CSV, JSON, TXT, MD, DOCX and PDF are supported"
    )


def _looks_tabular(text: str) -> bool:
    """A header line plus at least one row, with the same separator count on both."""
    lines = [line for line in text.splitlines() if line.strip()][:5]
    if len(lines) < 2:
        return False
    for sep in (",", ";", "\t", "|"):
        counts = [line.count(sep) for line in lines]
        if counts[0] >= 1 and len(set(counts)) == 1:
            return True
    return False


def absorb(data: bytes, filename: str, org_id: str = DEFAULT_ORG) -> dict:
    """Read a file and file it where it belongs. The one entry point callers want.

    Re-uploading a document replaces its passages rather than adding a second
    copy — otherwise an edited policy leaves the withdrawn version in the index
    and the avatar keeps quoting a rule the company no longer has.
    """
    products, prose = from_bytes(data, filename)
    source = Path(filename).name or "upload"

    if products:
        upsert(products, org_id)

    passages = documents.chunk(prose, source) if prose.strip() else []
    if passages:
        documents.replace_source(source, passages, org_id)

    return {"source": source, "products": len(products), "passages": len(passages)}


def seed_if_empty(org_id: str = DEFAULT_ORG) -> int:
    """Give a fresh install somebody to show, and nothing to sell.

    This used to load two sample CSVs that shipped in the repo. They no longer
    ship, and neither does any footage: a catalog and an avatar belong to
    whoever installed this, and putting one customer's products on another
    customer's panel is the whole reason tenancy exists.

    So the only thing seeded now is a single unnamed avatar with no clips. It
    renders as the silhouette in `poster.svg` — deliberately mute, deliberately
    unfinished-looking — which answers the question a blank white panel does not:
    this is working, and it is waiting for you.

    Products stay at zero. An empty catalog is the truth on a new install, and
    the Studio's Home page already says what to do about it.
    """
    from backend import store

    # Once per install, not whenever the machine happens to be empty. Someone who
    # deleted the placeholder in order to upload their own has said what they
    # want, and having it reappear on the next restart would be the app arguing
    # with them.
    marker = ROOT / "knowledge" / ".seeded"
    if marker.exists() or store.list_avatars():
        return 0

    store.create_avatar("Your avatar", org_id, greeting="Welcome.")
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text("placeholder avatar created" + chr(10), encoding="utf-8")
    return 0


def from_file(path: Path) -> list[Product]:
    """Products only. Kept because the CLI and the tests are about the catalog."""
    products, _ = from_bytes(path.read_bytes(), path.name)
    return products


def ingest(path: Path, org_id: str = DEFAULT_ORG) -> dict:
    result = absorb(path.read_bytes(), path.name, org_id)
    if not result["products"] and not result["passages"]:
        raise SystemExit(f"nothing usable in {path} — is there a name column, or any text?")
    return result


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 1

    products = passages = 0
    for arg in argv:
        path = Path(arg)
        if not path.exists():
            raise SystemExit(f"missing: {path}")
        try:
            result = ingest(path)
        except UnsupportedFile as exc:
            raise SystemExit(str(exc)) from exc
        print(f"  {path.name}: {result['products']} products, {result['passages']} passages")
        products += result["products"]
        passages += result["passages"]

    print(f"\n{products} products and {passages} passages indexed.")
    print("Try: python -m backend.ingest --search laptop")
    return 0


if __name__ == "__main__":
    # A Windows console defaults to cp1252 and raises on the rupee sign, which
    # turns printing a price into a crash. Fix the stream, not the data.
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except AttributeError:
        pass

    args = sys.argv[1:]
    if args and args[0] == "--search":
        from backend.catalog import search

        for product in search(" ".join(args[1:])):
            print(f"  {product.name:<24} {product.spoken_price():>10}  {product.category}")
        sys.exit(0)
    sys.exit(main(args))
