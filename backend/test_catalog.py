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


#: Counted so this suite reports a number like the other three. "All checks
#: passed" is indistinguishable from a suite that ran nothing, which is exactly
#: how running these through unittest looks.
passed = 0


def check(label: str, actual, expected) -> None:
    global passed
    if actual != expected:
        print(f"  FAIL  {label}\n        got      {actual!r}\n        expected {expected!r}")
        sys.exit(1)
    passed += 1
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

    # --- the Shopify path, offline ---------------------------------------------
    # A real store's products.json is one shape, so the mapping is checked against
    # a captured node rather than against the network. The whole point of this
    # path is that it keeps what JSON-LD drops, so that is what is asserted.
    from backend.crawl import PRODUCT_PATH, _plain, _shopify_product

    node = {
        "handle": "indigo-kurta-set",
        "title": "Indigo Kurta Set",
        "product_type": "Kurta Sets",
        "vendor": "Dhiyona",
        "tags": ["Ethnic", "Indigo", "Cotton"],
        "body_html": "<p>Hand-block printed &amp; <b>breathable</b>.</p><script>x()</script>",
        "images": [{"src": "https://cdn/1.jpg"}, {"src": "https://cdn/2.jpg"}],
        "options": [{"name": "Size", "values": ["S", "M", "L"]}],
        "variants": [
            {"title": "S", "price": "1899.00", "sku": "K-S", "available": False},
            {"title": "M", "price": "1799.00", "sku": "K-M", "available": True},
        ],
    }
    p = _shopify_product(node, "https://shop", "INR")
    check("shopify: handle is the id", p.id, "indigo-kurta-set")
    check("shopify: product_type is the category", p.category, "Kurta Sets")
    # The cheapest variant, not the first: a listing with sizes shows "from".
    check("shopify: price is the lowest variant", p.price, 1799.0)
    # One variant sold out must not take the whole product off the floor.
    check("shopify: in stock if any variant is", p.availability, "in_stock")
    # attributes reaches two places that both punish a junk drawer: the model's
    # prompt via Product.as_line(), and the visitor's screen. Image URLs went to
    # both — a shop window listing cdn.shopify.com links.
    check("shopify: image urls stay out of attributes", "images" in p.attributes, False)
    check("shopify: the variant dump stays out too", "variants" in p.attributes, False)
    check("shopify: the image itself is still kept", p.image, "https://cdn/1.jpg")
    check("shopify: keeps the tags", p.attributes["tags"], "Ethnic, Indigo, Cotton")
    check("shopify: keeps the sizes", p.attributes["size"], "S, M, L")
    check("shopify: vendor becomes brand", p.attributes["brand"], "Dhiyona")
    check("shopify: markup and entities out of the description",
          p.description, "Hand-block printed & breathable.")
    check("shopify: script contents never reach the description",
          "x()" in p.description, False)

    check("a sold-out product says so",
          _shopify_product({**node, "variants": [{"price": "1", "available": False}]},
                           "https://shop", "INR").availability, "out_of_stock")
    # No variants at all must not raise on min() of an empty sequence.
    check("no variants is not a crash",
          _shopify_product({"handle": "x", "title": "X"}, "https://shop", "INR").price, None)

    # A real catalog tags products for its own import pipeline. Both kinds of tag
    # reach the model and the screen; only one is about the product.
    tagged = _shopify_product(
        {**node, "tags": ["Blue", "Myntra_ID_43918230", "Myntra_Scrape", "Silk"]},
        "https://shop", "INR",
    )
    check("shopify: merchant bookkeeping is dropped", tagged.attributes["tags"], "Blue, Silk")

    check("product urls jump the queue", bool(PRODUCT_PATH.search("https://s/products/a")), True)
    check("collections do not", bool(PRODUCT_PATH.search("https://s/collections/all")), False)
    check("plain text survives _plain", _plain("a  <br> b"), "a b")

    # One bucket per kind of thing. A real store had "Kurta Sets" and "Kurta
    # sets" as separate categories, and 1,375 "Sarees" beside 268 "saree" — every
    # split is stock a visitor cannot browse to.
    from backend.crawl import category

    check("category: casing is merged", category("Kurta sets"), "Kurta Sets")
    check("category: singular joins the plural", category("saree"), "Sarees")
    check("category: an existing plural is left alone", category("Sarees"), "Sarees")
    check("category: y becomes ies", category("Accessory"), "Accessories")
    # str.title() capitalises after any non-letter, which puts "Men'S Kurtas" on
    # a shop window.
    check("category: an apostrophe survives", category("Men's Kurta"), "Men's Kurtas")
    check("category: nothing stays nothing", category(""), "")

    print("")
    print(str(passed) + " passed, 0 failed")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
