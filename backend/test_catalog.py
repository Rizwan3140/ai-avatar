"""Checks for the parts of the catalog that decide what the avatar can say.

    python -m backend.test_catalog

Search relevance and query parsing are where a wrong answer becomes a wrong
sentence spoken to a customer, so they get assertions rather than a manual look.
No test framework — these run on their own.
"""

import sys
import tempfile
from pathlib import Path

from backend import catalog
from backend.ingest import from_rows


def fixture() -> None:
    """A deliberately mixed catalog: electronics and fashion in one table, because
    the schema has to hold both without a migration."""
    catalog.DB_PATH = Path(tempfile.mkdtemp()) / "test.db"
    catalog.upsert(
        from_rows(
            [
                {
                    "sku": "L1", "title": "Aria 14 Laptop", "type": "Laptops", "mrp": "₹1,299",
                    "details": "Ultra-light laptop, great for travel and everyday work",
                    "RAM": "16GB", "screen": "14 inch",
                },
                {
                    "sku": "L2", "title": "Titan Pro 16", "type": "Laptops", "mrp": "1899",
                    "details": "High performance with dedicated GPU, built for gaming",
                    "RAM": "32GB",
                },
                {
                    "sku": "D1", "title": "Midnight Wrap Dress", "type": "Dresses", "mrp": "2,499",
                    "details": "Floor length wrap dress for evening occasions",
                    "size": "S,M,L", "colour": "black", "fabric": "silk",
                },
                {
                    "sku": "D2", "title": "Linen Day Dress", "type": "Dresses", "mrp": "1299",
                    "details": "Relaxed summer dress", "colour": "white", "fabric": "linen",
                },
            ]
        )
    )


def check(label: str, actual, expected) -> None:
    if actual != expected:
        print(f"  FAIL  {label}\n        got      {actual!r}\n        expected {expected!r}")
        sys.exit(1)
    print(f"  ok    {label}")


def names(products) -> list[str]:
    return [p.name for p in products]


def main() -> int:
    fixture()
    print("catalog")

    # Column names nobody agreed on in advance still map to the right fields.
    aria = catalog.get("L1")
    check("maps sku/title/type/mrp/details", aria.name, "Aria 14 Laptop")
    check("parses '₹1,299' to a number", aria.price, 1299.0)

    # Unknown columns survive as attributes — this is what makes one schema serve
    # laptops and dresses at the same time.
    check("keeps unknown columns", aria.attributes.get("ram"), "16GB")
    check("keeps fashion columns", catalog.get("D1").attributes.get("fabric"), "silk")

    # Attribute values are searchable without anyone declaring the key.
    check("searches inside attributes", names(catalog.search("silk")), ["Midnight Wrap Dress"])

    # The questions a visitor actually asks.
    check("ranks by relevance", names(catalog.search("laptop for gaming"))[0], "Titan Pro 16")
    check("plain english finds a dress", names(catalog.search("evening dress"))[0], "Midnight Wrap Dress")
    check("category filter", len(catalog.search(category="Dresses")), 2)

    # Price is a filter, not a search term. Leaving "under 2000" in the query
    # matches the digits against product copy and returns noise.
    query, limit = catalog.parse_query("do you have any dresses under 2,000")
    check("extracts the price ceiling", limit, 2000.0)
    check("removes it from the query", "under" in query, False)
    check("applies the ceiling", names(catalog.search(query, max_price=limit)), ["Linen Day Dress"])

    check("no ceiling means none", catalog.parse_query("show me dresses")[1], None)

    # Regression: "show me laptops" once returned a keyboard first, because the
    # prefix "me*" matched "mechanical". Function words carry no product meaning
    # and a showroom cannot afford a nonsense first result.
    # Sorted, because the order here is bm25 relevance and asserting it would
    # make this brittle. What matters is that nothing else gets in.
    check("filler words match nothing", sorted(names(catalog.search("show me laptops"))),
          ["Aria 14 Laptop", "Titan Pro 16"])
    check("polite phrasing still works", len(catalog.search("do you have any dresses")), 2)
    check("only the question matters", names(catalog.search("I am looking for silk")),
          ["Midnight Wrap Dress"])

    # Punctuation is a syntax error in FTS5; a spoken sentence is full of it.
    check("survives spoken punctuation", len(catalog.search("what's the best laptop?")) > 0, True)
    check("empty query is not an error", len(catalog.search("")), 4)
    check("nonsense returns nothing", names(catalog.search("zzzz")), [])

    print("\ncrawler")

    from backend.crawl import _Extract, product_from_jsonld, product_from_meta

    # The shapes a real storefront actually emits: a @graph wrapper, a nested
    # brand object, a list of images, and availability as a schema.org URL.
    page = """<html><head>
    <script type="application/ld+json">
    {"@graph":[{"@type":"BreadcrumbList"},
     {"@type":"Product","name":"Midnight Wrap Dress","sku":"D-1001",
      "category":"Dresses","image":["https://cdn/a.jpg","https://cdn/b.jpg"],
      "brand":{"@type":"Brand","name":"Aurelia"},"material":"Silk",
      "offers":{"price":"2499.00","priceCurrency":"INR",
                "availability":"https://schema.org/InStock"}}]}
    </script>
    <meta property="og:type" content="product">
    <meta property="og:title" content="Fallback Product">
    <meta property="product:price:amount" content="1,299">
    </head><body><a href="/p/2">next</a></body></html>"""

    parser = _Extract()
    parser.feed(page)
    found = [p for p in (product_from_jsonld(n, "https://shop/p/1") for n in parser.jsonld) if p]

    check("ignores non-product json-ld", len(found), 1)
    crawled = found[0]
    check("reads name and sku", (crawled.name, crawled.id), ("Midnight Wrap Dress", "D-1001"))
    check("reads the nested offer", (crawled.price, crawled.currency), (2499.0, "INR"))
    check("normalises availability", crawled.availability, "in_stock")
    check("takes the first of many images", crawled.image, "https://cdn/a.jpg")
    check("flattens the brand object", crawled.attributes.get("brand"), "Aurelia")
    check("keeps vertical attributes", crawled.attributes.get("material"), "Silk")
    check("collects links to follow", parser.links, ["/p/2"])

    fallback = product_from_meta(parser.meta, "https://shop/p/9")
    check("opengraph fallback", (fallback.name, fallback.price), ("Fallback Product", 1299.0))

    print("\nall checks passed")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
