"""Checks for the parts of the catalog that decide what the avatar can say.

    python -m backend.test_catalog

Search relevance and query parsing are where a wrong answer becomes a wrong
sentence spoken to a customer, so they get assertions rather than a manual look.
No test framework — these run on their own.
"""

import sys
import tempfile
from pathlib import Path

from backend import catalog, prune
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
    # Naming a shelf returns the shelf. This asserted the opposite — that "show
    # me laptops" thinned to one laptop — on the reasoning that a browse should
    # say what the shop sells. But "show me laptops" is not a browse, it is a
    # person pointing at a shelf, and on the real catalog the same rule returned
    # eight products from eight categories for "show me kurta sets". Thinning is
    # for "what do you have"; a named category is the visitor doing the
    # narrowing themselves.
    check("naming a category returns the shelf", len(catalog.search("show me laptops")), 2)
    check("in either form", len(catalog.search(category="Laptops")), 2)
    check("polite phrasing still works", len(catalog.search("do you have any dresses")), 2)
    # And the shelf word is lifted out before ranking, so what is left ranks
    # within it rather than against it.
    check("lifts the shelf word out before ranking",
          catalog.parse_category("show me the laptops please")[0].split(),
          ["show", "me", "the", "please"])
    # Only shelves this org actually has. "kurta sets" is not one yet in this
    # fixture, so nothing is lifted — the multi-word case is checked below,
    # once the vocabulary fixture adds it.
    check("an unknown shelf lifts nothing",
          catalog.parse_category("show me the kurta sets")[1], "")
    check("only the question matters", names(catalog.search("I am looking for silk")),
          ["Midnight Wrap Dress"])

    # Punctuation is a syntax error in FTS5; a spoken sentence is full of it.
    check("survives spoken punctuation", len(catalog.search("what's the best laptop?")) > 0, True)
    # Four products across two categories, thinned to one of each. This is the
    # "show me what you have" case, and it is the whole point of the thinning:
    # a wall of a catalog is a search results page, not a showroom.
    check("empty query is not an error", len(catalog.search("")), 2)
    check("and shows one of each category", len(catalog.search("", per_category=False)), 4)
    check("nonsense returns nothing", names(catalog.search("zzzz")), [])

    print("\ncrawler")

    from backend.crawl import _Extract, _public_url, product_from_jsonld, product_from_meta

    # The shapes a real storefront actually emits: a @graph wrapper, a nested
    # brand object, a list of images, and availability as a schema.org URL.
    page = """<html><head>
    <script type="application/ld+json">
    {"@graph":[{"@type":"BreadcrumbList"},
     {"@type":"Product","name":"Midnight Wrap Dress","sku":"D-1001",
      "category":"Dresses","image":["https://cdn/a.jpg","https://cdn/b.jpg"],
      "video":{"@type":"VideoObject","contentUrl":"https://cdn/clip.mp4",
               "url":"https://shop/p/1#video"},
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
    check("reads the video's contentUrl, not its page url", crawled.video, "https://cdn/clip.mp4")
    check("flattens the brand object", crawled.attributes.get("brand"), "Aurelia")
    check("keeps vertical attributes", crawled.attributes.get("material"), "Silk")
    check("collects links to follow", parser.links, ["/p/2"])

    # Every photograph, not the first. A storefront publishes six or seven shots
    # of one garment and the crawler kept one — which is most of what a customer
    # wants to see before buying, discarded at the door.
    check("keeps every image on the node", crawled.images,
          ["https://cdn/a.jpg", "https://cdn/b.jpg"])
    check("and still reports a primary", crawled.image, "https://cdn/a.jpg")

    from backend.crawl import _images, _video

    # schema.org allows all three shapes and storefronts use all three.
    check("a bare string is one image", _images("https://cdn/x.jpg"), ["https://cdn/x.jpg"])
    check("ImageObjects are unwrapped",
          _images([{"url": "https://cdn/x.jpg"}, {"contentUrl": "https://cdn/y.jpg"}]),
          ["https://cdn/x.jpg", "https://cdn/y.jpg"])
    check("nothing is not an error", _images(None), [])

    check("a bare video url is used as-is", _video("https://cdn/clip.mp4"), "https://cdn/clip.mp4")
    check("a VideoObject's contentUrl is preferred over url",
          _video({"contentUrl": "https://cdn/clip.mp4", "url": "https://shop/p#video"}),
          "https://cdn/clip.mp4")
    check("a list takes the first playable clip",
          _video([{"contentUrl": "https://cdn/clip.mp4"}, {"contentUrl": "https://cdn/other.mp4"}]),
          "https://cdn/clip.mp4")
    check("no video is not an error", _video(None), "")

    for unsafe in ("ftp://example.com/shop", "http://127.0.0.1:8000", "http://user:pass@example.com"):
        try:
            _public_url(unsafe)
            check(f"rejects unsafe crawl url: {unsafe}", False, True)
        except ValueError:
            check(f"rejects unsafe crawl url: {unsafe}", True, True)

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

    # The whole store, not the first 5,000 of it. The studio's budget of 40
    # pages was being turned into a product count, 250 x 20. Dhiyona's first
    # men's product is the 8,294th in its list, so a shop with 1,777 men's
    # pieces imported none of them.
    import urllib.parse

    from backend import crawl as crawling

    asked = []

    def fake_json(url):
        asked.append(url)
        if url.endswith("/meta.json"):
            return {"currency": "INR"}
        page = int(urllib.parse.parse_qs(urllib.parse.urlparse(url).query)["page"][0])
        if page > 30:
            return {"products": []}
        return {"products": [
            {"handle": f"p{page}-{i}", "title": "Men's Sherwani" if page == 30 else "Kurta Set",
             "product_type": "Sherwani Sets" if page == 30 else "Kurta Sets",
             "variants": [{"price": "999", "available": True}]}
            for i in range(250)
        ]}

    real = crawling._json, crawling._public_url, crawling.DELAY
    crawling._json, crawling.DELAY = fake_json, 0
    crawling._public_url = lambda url: urllib.parse.urlparse(url)
    try:
        everything = crawling.crawl("https://shop.example", max_pages=40)
    finally:
        crawling._json, crawling._public_url, crawling.DELAY = real
    check("shopify: a store of 7,500 is read whole, past the old 5,000", len(everything), 7500)
    check("shopify: and so are the men's pieces at the end of its list",
          sum(1 for p in everything if p.category == "Sherwani Sets"), 250)
    check("shopify: it stops where the store's list does",
          max(int(u.split("page=")[1]) for u in asked if "page=" in u), 31)
    check("shopify: and never asks past the list's own cap",
          crawling.SHOPIFY_LIST_CAP, 25_000)

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

    print("\nfacets")

    # The shop's own tags beat a guess, and longest-first is the whole trick:
    # tested before "Gold", "Rose Gold" survives as its own colour.
    check("colour from tags", catalog.facets_of("Bangle", "", {"tags": "Jewellery, Gold"})[0], "Gold")
    check(
        "rose gold is not gold",
        catalog.facets_of("Bangle", "", {"tags": "Jewellery, Rose Gold"})[0],
        "Rose Gold",
    )
    check(
        "sea green is not green",
        catalog.facets_of("Saree", "", {"tags": "Sea Green"})[0],
        "Sea Green",
    )

    # Nine of five thousand rows carry no tags at all, which is what the text
    # fallback is for — and why it matches whole words, so "Red" is not found
    # inside "Shredded".
    check("falls back to the name", catalog.facets_of("Midnight Blue Saree", "", {})[0], "Blue")
    check("word boundaries hold", catalog.facets_of("Shredded Linen Top", "", {})[0], "")
    check("unknown colour stays empty", catalog.facets_of("Kurta", "", {"tags": "New"})[0], "")

    check("style from tags", catalog.facets_of("Lehenga", "", {"tags": "Festive"})[1], "Festive")
    check("no occasion stays empty", catalog.facets_of("Rakhi", "", {"tags": "New"})[1], "")

    # A colour in a sentence is a filter, not a search term — the same argument
    # as the price ceiling above.
    text, colour, _ = catalog.parse_facets("do you have a red saree")
    check("lifts the colour out", (text, colour), ("do you have a saree", "Red"))
    text, colour, _ = catalog.parse_facets("something in rose gold")
    check("longest colour wins in a sentence", (text, colour), ("something in", "Rose Gold"))
    check("lifts the occasion out", catalog.parse_facets("something for a wedding")[2], "Wedding")
    check("plain text is left alone", catalog.parse_facets("show me sarees")[1], "")

    # The filters reach the database, not only the parser. A feature that parses
    # perfectly and never reaches a query is the shape this project has been
    # caught by before.
    catalog.upsert(
        from_rows(
            [
                {"sku": "S1", "title": "Ruby Silk Saree", "type": "Sarees", "mrp": "3000",
                 "details": "Woven silk", "tags": "Sarees, Red, Festive"},
                {"sku": "S2", "title": "Ivory Silk Saree", "type": "Sarees", "mrp": "3200",
                 "details": "Woven silk", "tags": "Sarees, White"},
            ]
        )
    )
    check("filters by colour", names(catalog.search(category="Sarees", color="Red")),
          ["Ruby Silk Saree"])
    check("filters by style", names(catalog.search(style="Festive")), ["Ruby Silk Saree"])
    check("colour and category together", len(catalog.search(category="Sarees", color="White")), 1)

    # An occasion narrows exactly as a colour does, so it must switch the
    # one-per-category thinning off the same way. It did not, and every one of
    # this shop's wedding pieces is a lehenga — so "something for a wedding"
    # filtered correctly to twenty and then thinned to one. The thinning that
    # stops a browse looking like a warehouse was emptying the rail somebody had
    # asked to see.
    catalog.upsert(
        from_rows(
            [
                {"sku": f"W{i}", "title": f"Wedding Lehenga {i}", "type": "Lehengas",
                 "mrp": "5000", "details": "Sequinned net", "tags": "Lehengas, Wedding"}
                for i in range(5)
            ]
        ),
        org_id="occasion",
    )
    check("an occasion is not thinned to one per category",
          len(catalog.search(style="Wedding", org_id="occasion")), 5)

    # Offered from the rows, so a shop that stocks nothing turquoise is never
    # shown a turquoise filter that comes back empty.
    check("lists only stocked colours", "Red" in catalog.colors(), True)
    check("does not offer absent colours", "Turquoise Blue" in catalog.colors(), False)

    # One per (category, colour), and a colourless row is its own bucket rather
    # than a row that vanishes — otherwise a category whose products are all
    # untagged disappears from the shop entirely.
    rows = [
        {"id": "a", "category": "Sarees", "color": "Red", "price": 90.0,
         "image": "x", "availability": "in_stock"},
        {"id": "b", "category": "Sarees", "color": "Red", "price": 10.0,
         "image": "x", "availability": "in_stock"},
        {"id": "c", "category": "Sarees", "color": "Blue", "price": 50.0,
         "image": "x", "availability": "in_stock"},
        {"id": "d", "category": "Sarees", "color": "", "price": 50.0,
         "image": "x", "availability": "in_stock"},
        {"id": "e", "category": "Sarees", "color": "Red", "price": 1.0,
         "image": "", "availability": "in_stock"},
    ]
    kept = sorted(r["id"] for r in prune.choose(rows))
    check("one per category and colour", kept, ["b", "c", "d"])
    check("a photograph beats a lower price", "e" in kept, False)

    # ---- what customers call things ----------------------------------------
    print("\nvocabulary")

    # The reported failure: a shop whose largest category is sarees answered
    # "we do not carry those" to somebody asking for a sari. The word is the
    # standard English spelling, the shop files it as "Sarees", and keyword
    # search matched neither to the other.
    catalog.upsert(
        from_rows(
            [
                {"sku": "V1", "title": "Banarasi Silk", "type": "Sarees", "mrp": "4000",
                 "details": "Woven silk with zari border"},
                {"sku": "V2", "title": "Anarkali Set", "type": "Kurta Sets", "mrp": "2500",
                 "details": "Cotton kurta with palazzo"},
            ]
        )
    )
    check("a sari finds the sarees", catalog.search("sari")[0].category, "Sarees")
    check("so does the plural", catalog.search("saris")[0].category, "Sarees")
    check("and a salwar suit finds kurta sets",
          catalog.search("salwar")[0].category, "Kurta Sets")
    # A two-word shelf is lifted whole. Leaving "sets" behind would rank a
    # jewellery set against the kurta sets the visitor asked for.
    check("lifts a multi-word category cleanly",
          catalog.parse_category("show me the kurta sets please")[0].split(),
          ["show", "me", "the", "please"])
    check("and filters to it", {p.category for p in catalog.search("show me kurta sets")},
          {"Kurta Sets"})

    # ---- departments ---------------------------------------------------------
    print("\ndepartments")

    # "Men's wear" used to be an alias for the Men's Kurtas shelf, so a shop
    # with men's kurtas, pyjamas and pants answered it with kurtas alone. It is
    # a department now: read from the shop's own tags, browsed as shelves.
    RAILS = "rails"
    P = catalog.Product
    catalog.upsert(
        [
            P(id="m1", name="Black Satin Kurta", category="Men's Kurtas",
              attributes={"tags": "Men, Mens collection, Black"}),
            P(id="m2", name="White Churidar Pyjama", category="Pyjamas", attributes={"tags": "Men"}),
            P(id="m3", name="Black Cotton Pant", category="Pants", attributes={"tags": "Men, Black"}),
            P(id="w1", name="Red Silk Kurta", category="Kurtas", attributes={"tags": "Women"}),
            P(id="w2", name="Cream Pants", category="Pants", attributes={"tags": "Women"}),
            # This export really does carry `Women"` with a stray quote.
            P(id="w3", name="Blue Saree", category="Sarees", attributes={"tags": 'Sarees, Women"'}),
            P(id="w4", name="Linen Midi Dress", category="Dresses", attributes={"tags": "Women"}),
            P(id="w5", name="Anarkali Set", category="Kurta Sets", attributes={"tags": "Women"},
              description="Pairs well with a drop earring."),
            P(id="j1", name="Drop Earring", category="Earrings", attributes={"tags": "Jewellery, Women"}),
            P(id="j2", name="Diamond Necklace Set", category="Jewellery Sets",
              attributes={"tags": "Jewellery, Women"}),
            P(id="j3", name="Black Beaded Bangle", category="Bangles",
              attributes={"tags": "Jewellery, Black"}),
            # No tag says so; the shelf does.
            P(id="j4", name="Purple Potli", category="Ethnic Bags", attributes={"tags": "Women"}),
            P(id="u1", name="Thread Rakhi", category="Rakhis", attributes={"tags": "Accessories, Unisex"}),
            # Nothing says who these are for.
            P(id="n1", name="Plain Shawl", category="Shawls"),
            P(id="n2", name="Women's Wool Cape", category="Capes"),
        ],
        RAILS,
    )

    def dept(pid):
        p = catalog.get(pid, RAILS)
        return catalog.department_of(p.name, p.category, p.attributes)

    check("a Men tag is men's wear", dept("m1"), "men")
    check("a Women tag is women's wear", dept("w1"), "women")
    check("a stray quote in the tag does not hide it", dept("w3"), "women")
    check("jewellery is not clothing, whoever it is for", dept("j1"), "jewellery")
    check("a bag is an accessory though no tag says so", dept("j4"), "accessories")
    check("a rakhi is an accessory", dept("u1"), "accessories")
    # Jewellery and accessories are told apart by the shelf, because this
    # shop's tags do not: its rakhis are tagged both, and its belts — on a shelf
    # called Accessories — are tagged "Jewellery, Earrings". Filed together,
    # Rakhis was the first tile under Jewellery.
    check("a rakhi tagged Jewellery as well is still an accessory",
          catalog.department_of("Thread Rakhi", "Rakhis", {"tags": "Accessories, Jewellery, Rakhi"}),
          "accessories")
    check("a belt on the Accessories shelf is one, whatever it is tagged",
          catalog.department_of("Sequin Belt", "Accessories", {"tags": "Jewellery, Earrings, Women"}),
          "accessories")
    check("an Accessories tag outranks a Jewellery one where the shelf is silent",
          catalog.department_of("Hair Clip", "Extras", {"tags": "Jewellery, Accessories"}),
          "accessories")
    # Filed nowhere, tagged "Ethnic Bags": it was being counted as women's
    # clothing, and turning up among the sarees.
    check("a potli with no shelf is placed by its tags",
          catalog.department_of("Mirror Work Potli", "", {"tags": "Ethnic Bags, Women"}),
          "accessories")
    check("and a saree with no shelf is still clothing",
          catalog.department_of("Cotton Saree", "", {"tags": "Sarees, Women"}), "women")
    check("with no tag the name is read", dept("n2"), "women")
    check("and with nothing to read, nothing is guessed", dept("n1"), "")
    check("a dress tagged 'with belt' is still a dress",
          catalog.department_of("Wrap Dress", "Dresses", {"tags": "Women, With Belt"}), "women")

    for said, want in (("Show me menswear.", "men"), ("show mens products", "men"),
                       ("gents collection", "men"), ("Show me women's wear.", "women"),
                       ("something for ladies", "women"), ("Show me jewellery.", "jewellery"),
                       ("show me accessories", "accessories"),
                       ("show me sarees", ""), ("for men and women", "")):
        check(f"department of: {said}", catalog.parse_department(said)[1], want)
    check("the department's words are taken out",
          catalog.parse_department("show me men's kurtas")[0], "show me kurtas")

    # The tiles a visitor picks from. Pants holds one men's piece and one
    # women's, and each department's tile counts only its own.
    check("men's wear is three shelves, not one",
          [(s["category"], s["count"]) for s in catalog.shelves(RAILS, "men")],
          [("Kurtas", 1), ("Pants", 1), ("Pyjamas", 1)])
    check("women's wear has no jewellery among its shelves",
          {s["category"] for s in catalog.shelves(RAILS, "women")},
          {"Kurtas", "Pants", "Sarees", "Dresses", "Kurta Sets", "Capes"})
    check("jewellery is its own, with no rakhi or bag in it",
          {s["category"] for s in catalog.shelves(RAILS, "jewellery")},
          {"Earrings", "Jewellery Sets", "Bangles"})
    check("and accessories are theirs",
          {s["category"] for s in catalog.shelves(RAILS, "accessories")},
          {"Ethnic Bags", "Rakhis"})
    # Both are reached from the one Jewellery chip. The accessories are not
    # among its tiles; one last tile leads on to them.
    _tiles = catalog.tiles(RAILS, "jewellery")
    check("the jewellery tiles end with one that leads to accessories",
          [(t["category"], t["count"], t.get("opens")) for t in _tiles[-1:]],
          [("Accessories", 2, "accessories")])
    check("and every tile before it is a shelf of jewellery",
          [t.get("opens") for t in _tiles[:-1]], [None, None, None])
    check("other departments have no such tile",
          [t for t in catalog.tiles(RAILS, "men") if t.get("opens")], [])

    def ids(query, **kw):
        return {p.id for p in catalog.search(query, org_id=RAILS, **kw)}

    # A shelf within a department. "Kurtas" as a phrase matches the women's
    # shelf exactly and Men's Kurtas at 0.67 — under the cutoff.
    check("men's kurtas are on the men's shelf", ids("show me men's kurtas"), {"m1"})
    check("heard without the apostrophe", ids("Men's, curtas?"), {"m1"})
    check("women's kurtas are not", ids("women's kurtas"), {"w1"})
    check("men's pants is the men's one", ids("show me men's pants"), {"m3"})
    check("ladies pants is the women's one", ids("ladies pants"), {"w2"})
    check("a shelf's own word is not then searched for", ids("show me women's dresses"), {"w4"})
    check("jewellery sets is a shelf of jewellery", ids("show me jewellery sets"), {"j2"})
    check("a tile opens its shelf in its department",
          ids("", category="Pants", department="men"), {"m3"})
    check("men's sarees is nothing, not the women's sarees", ids("men's sarees"), set())

    # Never one list. A browse is clothes; a ranked search is the kind its best
    # match is; a named shelf or department has already chosen.
    def kinds(found):
        return {catalog.department_of(p.name, p.category, p.attributes) in catalog.EXTRAS for p in found}

    check("a browse is clothes only", kinds(catalog.search("", org_id=RAILS)), {False})
    check("a colour on its own is clothes only",
          ids("", color="Black"), {"m1", "m3"})
    check("earring is jewellery, not the set whose blurb mentions one", ids("earring"), {"j1"})
    check("a jewellery colour still reaches jewellery when asked",
          ids("", color="Black", department="jewellery"), {"j3"})

    # "Show me bags" was answered with bangles. Only "bag" was an alias, so the
    # plural fell through to the fuzzy match, where "bags" is 0.73 against
    # "bangles".
    check("bags are bags, not bangles", ids("show me bags"), {"j4"})
    check("and so is one bag", ids("show me a bag"), {"j4"})
    # "Bracelet" is an alias for Bangles — right for a shop with no Bracelets
    # shelf, and it must not beat that shelf where there is one.
    check("an alias stands in where there is no such shelf",
          catalog._aliased("bracelet", {"bangles": "Bangles"}), "Bangles")
    check("and gives way to the shelf itself where there is",
          catalog._aliased("bracelet", {"bangles": "Bangles", "bracelets": "Bracelets"}), "Bracelets")

    # A catalog derived under the old rules filed its rakhis with the jewellery,
    # and a department is stored, not recomputed. The rules carry a version, and
    # an older one derives every row again.
    with catalog._connect() as conn:
        conn.execute("UPDATE products SET department = 'jewellery' WHERE org_id = ? AND id = 'u1'", (RAILS,))
        conn.execute("PRAGMA user_version = 1")
    catalog._initialised.clear()
    catalog.init()
    check("a catalog filed under the old rules is filed again",
          {s["category"] for s in catalog.shelves(RAILS, "accessories")}, {"Ethnic Bags", "Rakhis"})
    with catalog._connect() as conn:
        check("and remembers which rules it was filed under",
              conn.execute("PRAGMA user_version").fetchone()[0], catalog.DEPARTMENT_RULES)

    # ---- products that came with no shelf ------------------------------------
    print("\nunshelved")

    # This shop exported twelve sarees and a potli with no product type, each
    # tagged with the shelf it belongs on. Search found them; a visitor choosing
    # a category never could, and the Sarees tile counted 22 of 34.
    FILED = "filed"
    catalog.upsert(
        [
            P(id="s1", name="Blue Saree", category="Sarees", attributes={"tags": "Sarees, Women"}),
            P(id="b1", name="Clutch Bag", category="Ethnic Bags", attributes={"tags": "Women"}),
        ],
        FILED,
    )
    catalog.upsert(
        [
            P(id="s2", name="Handloom Cotton", attributes={"tags": "Women, Sarees"}),
            P(id="b2", name="Mirror Potli", attributes={"tags": 'Ethnic Bags, Women"'}),
            P(id="x1", name="Mystery Piece", attributes={"tags": "Women, Saree lovers, New"}),
            P(id="k1", name="Silk Kurta", category="Kurtas", attributes={"tags": "Sarees"}),
        ],
        FILED,
    )
    check("a saree with no shelf is filed under its Sarees tag", catalog.get("s2", FILED).category, "Sarees")
    check("and a potli under its Ethnic Bags tag", catalog.get("b2", FILED).category, "Ethnic Bags")
    check("which makes it an accessory, on the accessories rail",
          [(s["category"], s["count"]) for s in catalog.shelves(FILED, "accessories")],
          [("Ethnic Bags", 2)])
    check("a tag that only mentions a shelf is not one", catalog.get("x1", FILED).category, "")
    check("a shelf the shop set is never overridden by a tag", catalog.get("k1", FILED).category, "Kurtas")
    check("the tile now counts every saree",
          [s["count"] for s in catalog.shelves(FILED, "women") if s["category"] == "Sarees"], [2])

    check("a singular tag names a plural shelf",
          catalog.shelved([P(id="a", name="A", attributes={"tags": "Saree"}),
                           P(id="b", name="B", category="Sarees")])[0].category, "Sarees")
    # A mirror replaces the whole catalog, so its batch is all the shelves
    # there are: a tag naming a shelf nobody in it is on names nothing.
    check("a tag cannot name a shelf that does not exist",
          catalog.shelved([P(id="a", name="A", attributes={"tags": "Sarees"})])[0].category, "")
    check("unless the org already has it",
          catalog.shelved([P(id="a", name="A", attributes={"tags": "Sarees"})], ["Sarees"])[0].category,
          "Sarees")

    # A catalog already on disk is filed the next time it is opened.
    with catalog._connect() as conn:
        conn.execute("UPDATE products SET category = '' WHERE org_id = ? AND id = 's2'", (FILED,))
        conn.execute("PRAGMA user_version = 2")
    catalog._initialised.clear()
    catalog.init()
    check("an existing catalog is filed on its next open", catalog.get("s2", FILED).category, "Sarees")
    check("and found under that shelf",
          "s2" in {p.id for p in catalog.search("", "Sarees", org_id=FILED)}, True)

    # ---- pieces that do not say who they are for ----------------------------
    print("\nunlabelled")

    # Three of this shop's largest suppliers tag a kurta set "Kurta Sets, Casual
    # Wear" and never "Women". 4,646 of its first 20,000 products had no
    # department, so Women's wear counted a fraction of the women's wear. The
    # shelf knows: every labelled Kurta Set is a woman's.
    SETTLED = "settled"

    def rows(shelf, tags, count, prefix):
        return [P(id=f"{prefix}{i}", name=f"Piece {prefix}{i}", category=shelf,
                  attributes={"tags": tags}) for i in range(count)]

    catalog.replace(
        rows("Co-ords", "Women", 19, "cw") + rows("Co-ords", "Casual Wear", 30, "cu")
        + rows("Sherwani Sets", "Men", 5, "sm") + rows("Sherwani Sets", "Festive", 1, "su")
        # Mixed: five to one is 83%, and an unlabelled kurta could be either.
        + rows("Kurtas", "Women", 5, "kw") + rows("Kurtas", "Men", 1, "km") + rows("Kurtas", "", 1, "ku")
        # Too few labelled to speak for anything.
        + rows("Suits", "Women", 2, "tw") + rows("Suits", "", 1, "tu")
        + rows("Earrings", "", 2, "eu"),
        SETTLED,
    )

    def stored(pid):
        with catalog._connect() as conn:
            return conn.execute(
                "SELECT department FROM products WHERE org_id = ? AND id = ?", (SETTLED, pid)
            ).fetchone()[0]

    check("an unlabelled piece takes its shelf's department", stored("cu0"), "women")
    check("on a men's shelf too", stored("su0"), "men")
    check("a mixed shelf does not answer for its unlabelled pieces", stored("ku0"), "")
    check("nor does a shelf with too few labelled", stored("tu0"), "")
    check("jewellery is not a question of who it is for", stored("eu0"), "jewellery")
    check("the tile counts every piece on the shelf",
          [s["count"] for s in catalog.shelves(SETTLED, "women") if s["category"] == "Co-ords"], [49])

    # Saved again, the piece arrives saying nothing — and is settled again.
    catalog.upsert(rows("Co-ords", "Casual Wear", 1, "cu"), SETTLED)
    check("it stays settled when it is saved again", stored("cu0"), "women")

    # An inference is not evidence. Two men's co-ords make the labelled ones 19
    # to 2, 90%: mixed. Counted with the 30 inferred it would read 49 to 2, 96%,
    # and the shelf would have voted itself into a department.
    catalog.upsert(rows("Co-ords", "Men", 2, "cm"), SETTLED)
    check("a shelf that turns out mixed gives its inferences back", stored("cu0"), "")
    check("and keeps the labels the shop set", (stored("cw0"), stored("cm0")), ("women", "men"))

    # A catalog already on disk is settled the next time it is opened.
    catalog.delete("cm0", SETTLED)
    catalog.delete("cm1", SETTLED)
    check("removing them alone settles nothing", stored("cu0"), "")
    with catalog._connect() as conn:
        conn.execute("PRAGMA user_version = 3")
    catalog._initialised.clear()
    catalog.init()
    check("an existing catalog is settled on its next open", stored("cu0"), "women")

    # `python -m backend.categorize`: the same filing, run over what is on disk,
    # and a report of what could not be placed — which is the useful half.
    from backend import categorize

    with catalog._connect() as conn:
        conn.execute("UPDATE products SET department = 'men' WHERE org_id = ? AND id = 'cw0'", (SETTLED,))
    check("the program files every product again", catalog.categorise() > 0, True)
    check("putting right a department that had gone wrong", stored("cw0"), "women")
    check("and leaving a settled piece settled", stored("cu0"), "women")

    said = categorize.report(SETTLED)
    check("the report counts each department",
          [line.split() for line in said.splitlines() if line.strip().startswith("Women's wear")],
          [["Women's", "wear", "56", "on", "3", "shelves"]])
    check("it names a shelf it could not place, and why",
          [line.split(None, 2)[2] for line in said.splitlines() if " Kurtas " in line],
          ["mixed: 5 women's, 1 men's (83.3%, under the 95% it takes)"])
    check("a shelf with too few labelled says so",
          [line.split(None, 2)[2] for line in said.splitlines() if " Suits " in line],
          ["only 2 of its pieces say who they are for"])
    check("the report changes nothing", (categorize.report(SETTLED), stored("ku0")), (said, ""))

    # ---- one shelf for what a shop lists as many -----------------------------
    print("\ncombinations")

    # A storefront's product type describes the product, not the rail. Dhiyona
    # lists a kurta sold with trousers under seven types, and Men's wear was
    # twenty-four tiles of which seven said kurta. These are its real names.
    have = catalog._known_shelves(
        ["Kurta Sets", "Kurtas", "Pyjamas", "Dhotis", "Jackets", "Pants", "Shirts",
         "Jodhpuris", "Suit Sets", "Sarees", "Pathani Kurta Sets", "Necklace Sets"]
    )
    for listed, shelf in (
        ("Kurta And Pyjama Sets", "Kurta Sets"),
        ("Kurta, Jacket And Pyjama Sets", "Kurta Sets"),
        ("Kurta, Jacket And Dhoti Sets", "Kurta Sets"),
        ("Kurta, Pyjama & Dupatta Sets", "Kurta Sets"),
        ("Kurta And Dhoti Pant, Dupatta Sets", "Kurta Sets"),
        ("Kurta Dhoti And Dupatta Sets", "Kurta Sets"),
        ("Suit Set With Dupattas", "Suit Sets"),
        # The same combination, with nothing joining it.
        ("Kurta Pyjama Sets", "Kurta Sets"),
        ("Kurta Dhoti Jacket Sets", "Kurta Sets"),
        ("Kurta Pant Sets", "Kurta Sets"),
        # No Sets shelf for the garment, so the garment's own.
        ("Shirt And Mundu Sets", "Shirts"),
        ("Jodhpuri And Pyjama Sets", "Jodhpuris"),
        # Who it is for is a department now, not part of the shelf's name.
        ("Men's Kurtas", "Kurtas"),
        ("Women Pants", "Pants"),
    ):
        check(f"{listed} is on {shelf}", catalog.simple_shelf(listed, have), shelf)
    for listed in ("Sarees", "Kurta Sets", "Necklace Sets",
                   # A style of kurta set, not a kurta with something else.
                   "Pathani Kurta Sets",
                   # Not a set, and no Apparel shelf to go to: left as written.
                   "Apparel & Accessories"):
        check(f"{listed} is left as it is", catalog.simple_shelf(listed, have), listed)
    check("with no such shelf yet it is given a simple name, never a merged one",
          catalog.simple_shelf("Kurta, Jacket And Pyjama Sets", {}), "Kurta Sets")

    FOLDED = "folded"
    catalog.replace(
        [P(id=f"w{i}", name=f"Printed Set {i}", category="Kurta Sets", attributes={"tags": "Women"})
         for i in range(6)]
        + [P(id=f"u{i}", name=f"Casual Set {i}", category="Kurta Sets", attributes={"tags": "Casual"})
           for i in range(3)]
        + [P(id=f"m{i}", name=f"Festive Set {i}", category="Kurta And Pyjama Sets",
             attributes={"tags": "Men"}) for i in range(6)]
        + [P(id="mk", name="Plain Kurta", category="Men's Kurtas"),
           P(id="wk", name="Plain Kurta", category="Kurtas", attributes={"tags": "Women"})],
        FOLDED,
    )
    check("the combinations share one shelf with what they lead with",
          sorted(catalog.categories(FOLDED)), ["Kurta Sets", "Kurtas"])
    check("each department's tile counts its own",
          ([(s["category"], s["count"]) for s in catalog.shelves(FOLDED, "men")],
           [(s["category"], s["count"]) for s in catalog.shelves(FOLDED, "women")]),
          ([("Kurta Sets", 6), ("Kurtas", 1)], [("Kurta Sets", 9), ("Kurtas", 1)]))
    check("what the shop called it is kept on the product",
          catalog.get("m0", FOLDED).attributes["type"], "Kurta And Pyjama Sets")
    check("so its own words still find it",
          {p.id for p in catalog.search("pyjama", org_id=FOLDED, per_category=False)},
          {f"m{i}" for i in range(6)})
    check("and Men's Kurtas still says who it is for, filed on Kurtas",
          catalog.search("", "Kurtas", org_id=FOLDED, department="men")[0].id, "mk")
    # Folding put men's sets on a shelf of women's. A shelf that mixed answers
    # for nobody — so an unlabelled piece is judged by what the shop listed it
    # as, and everything listed as plain Kurta Sets is a woman's.
    check("an unlabelled piece is judged by what the shop listed it as",
          [s["count"] for s in catalog.shelves(FOLDED, "women") if s["category"] == "Kurta Sets"], [9])
    again = catalog.shelved(catalog.all_products(FOLDED))
    check("filing what is already filed changes nothing",
          [(p.category, p.attributes) for p in again],
          [(p.category, p.attributes) for p in catalog.all_products(FOLDED)])

    # A row saved by an older release, picked from the version menu, has no
    # department at all. It is filled in the next time the catalog is opened.
    with catalog._connect() as conn:
        conn.execute("UPDATE products SET department = NULL WHERE org_id = ? AND id = 'm2'", (RAILS,))
    check("a row with no department is on no rail",
          [s["category"] for s in catalog.shelves(RAILS, "men")], ["Kurtas", "Pants"])
    catalog._initialised.clear()
    catalog.init()
    check("until the catalog is next opened",
          [s["category"] for s in catalog.shelves(RAILS, "men")], ["Kurtas", "Pants", "Pyjamas"])

    _cats = catalog.categories
    catalog.categories = lambda org_id=catalog.DEFAULT_ORG: ["Men's Kurtas", "Kurtas", "Sarees"]
    check("womens is not mens", catalog.parse_category("womens kurtas")[1], "Kurtas")
    # From the event log, 30 September: shelves we stock, heard as other words,
    # each answered "we don't carry those".
    for heard, shelf in (("Show me some Curtis.", "Kurtas"), ("Show me pink curtas.", "Kurtas"),
                         ("Show me the saddies.", "Sarees"), ("show me some sadies.", "Sarees")):
        check(f"heard: {heard}", catalog.parse_category(heard)[1], shelf)
    catalog.categories = _cats

    # Chatter that put products on screen: "morning", "meet", "listen" and
    # "more" each matched somebody's product copy.
    for said in ("Hello, good morning.", "Nice to meet you", "Listen.", "One more.", "Okay, well, yeah.",
                 "Does this come in other colours?"):
        check(f"not a search: {said}", catalog._fts_terms(said), [])
    # And "maybe" was the one word stopping a colour from browsing on its own.
    check("something in black is a colour, not a search",
          catalog.parse_facets("Maybe something in black.")[1:], ("Black", ""))
    check("with nothing left to search for",
          catalog._fts_terms(catalog.parse_facets("Maybe something in black.")[0]), [])

    # difflib covers what the alias table does not: plurals, typos, and the
    # transcription errors a microphone in a mall will produce.
    check("a singular finds a plural category", catalog.resolve_category("saree"), "Sarees")
    check("a typo still lands", catalog.resolve_category("sarees"), "Sarees")

    # And the half that matters more. An avatar that answers "do you have a
    # laptop" with sarees is worse than one that says no — a false match here
    # is the fabrication this project spent months removing.
    # Absent from this fixture, which does stock laptops and dresses — the
    # point is that a word for something nobody sells matches nothing, not that
    # these particular words are unmatchable everywhere.
    for absent in ("washing machine", "refrigerator", "motorcycle", "television"):
        check(f"{absent!r} matches no category", catalog.resolve_category(absent), "")

    # A rhyme is not a typo. Both of these clear the 0.7 cutoff at 0.727 against
    # a real Dhiyona shelf, so "show me laptops" filled the panel with linen
    # tops while the avatar was saying out loud that we do not sell laptops, and
    # "what kind of things do you have" answered with three rings.
    #
    # A separate org, because the fixture above deliberately stocks Laptops and
    # "laptops" must go on matching those.
    rhyme = "rhymes"
    catalog.upsert(
        [
            catalog.Product(id="T1", name="Linen Sleeveless Top", category="Tops"),
            catalog.Product(id="R1", name="Circles Big Ring", category="Rings"),
        ],
        org_id=rhyme,
    )
    check("'laptops' does not rhyme its way onto Tops",
          catalog.resolve_category("laptops", org_id=rhyme), "")
    check("'things' does not rhyme its way onto Rings",
          catalog.resolve_category("things", org_id=rhyme), "")
    # And the guard costs nothing real: a mishearing keeps its first letter.
    check("a mishearing still lands",
          catalog.resolve_category("tpos", org_id=rhyme), "Tops")
    check("and the shelf itself still lands",
          catalog.resolve_category("rings", org_id=rhyme), "Rings")

    # Nothing to search for is not the same as nothing to search by. An empty
    # query browses the catalog; a sentence whose every word is a stopword is a
    # greeting, and it was taking the browse path — so "hi there how are you"
    # put eight unrelated products on the panel.
    check("a greeting shows nothing", catalog.search("hi there how are you"), [])
    check("and so does a question about the shop",
          catalog.search("What are your opening hours?"), [])
    check("but an empty query still browses", len(catalog.search("")) > 0, True)
    check("and a real request still finds its shelf",
          {p.category for p in catalog.search("show me dresses")}, {"Dresses"})

    # One incidental hit is enough to return a row, because the terms are OR-ed.
    # That is right for a single word and wrong the moment somebody says two:
    # asked for a "mobile phone", this shop offered a potli and a jacket, each
    # matching one term of two because both blurbs mention keeping a phone.
    catalog.upsert(
        from_rows(
            [
                # A jacket, not the potli of the original report: a bag and a
                # dress are no longer one list, and this is about the terms.
                {"sku": "P1", "title": "Casino Stripe Jacket", "type": "Jackets",
                 "mrp": "900", "details": "Where to keep your phone and money?"},
                {"sku": "P2", "title": "Mobile Charging Dress", "type": "Dresses",
                 "mrp": "900", "details": "A pocket for your mobile phone"},
            ]
        ),
        org_id="corroborate",
    )
    both = [p.id for p in catalog.search("mobile phone", org_id="corroborate",
                                         per_category=False)]
    check("a row carrying one term of two is dropped", "P1" not in both, True)
    check("and one carrying both is kept", both, ["P2"])
    # A single word has no second word to agree with, so nothing is required of
    # it — "party" must go on returning the pieces whose copy says party.
    check("a single term is never held to it",
          len(catalog.search("phone", org_id="corroborate", per_category=False)), 2)

    # It only runs on a miss, so it can never override a real result.
    # The gallery survives a write and a read, and the primary leads it without
    # being repeated — a caller wanting one picture reads `image` and never
    # learns this exists.
    catalog.upsert(
        [
            catalog.Product(
                id="G1", name="Banarasi Silk", category="Sarees",
                image="https://cdn/1.jpg",
                images=["https://cdn/1.jpg", "https://cdn/2.jpg", "https://cdn/3.jpg"],
            )
        ]
    )
    stored = catalog.get("G1")
    check("a gallery round-trips", stored.images,
          ["https://cdn/1.jpg", "https://cdn/2.jpg", "https://cdn/3.jpg"])
    check("the primary is not duplicated", stored.images.count("https://cdn/1.jpg"), 1)

    catalog.upsert([catalog.Product(id="G2", name="One Shot", image="https://cdn/only.jpg")])
    check("one photograph is still a gallery of one",
          catalog.get("G2").images, ["https://cdn/only.jpg"])
    check("and a product with none has none", catalog.gallery(catalog.Product(id="x", name="x")), [])

    catalog.upsert([catalog.Product(id="G3", name="Runway Sari", video="https://cdn/runway.mp4")])
    check("a product video round-trips", catalog.get("G3").video, "https://cdn/runway.mp4")
    check("a product with none has none", catalog.get("G2").video, "")

    check("a real match is not second-guessed",
          catalog.search("Banarasi")[0].name, "Banarasi Silk")

    print("")
    print(str(passed) + " passed, 0 failed")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
