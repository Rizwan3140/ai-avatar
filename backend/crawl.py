"""Turn a company's website into catalog rows.

    python -m backend.crawl https://shop.example.com

Reads structured data before it reads HTML. Most e-commerce sites already
publish schema.org `Product` as JSON-LD — for Google, not for us, but it is the
same information: name, price, currency, image, availability, description, all
declared rather than guessed. Scraping the rendered page is the fallback, not the
plan, because a layout change breaks a scraper and never breaks JSON-LD.

Stdlib only. `urllib` fetches, `html.parser` parses, `json` reads the payload,
and `urllib.robotparser` checks we are allowed. A crawler that needs a paid API
to read a public page is a crawler that stops working when the invoice does.
"""

import html as html_module
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
from html.parser import HTMLParser

from backend.catalog import Product, upsert

USER_AGENT = "LuxoraBot/1.0 (+showroom catalog indexer)"
TIMEOUT = 15
#: Politeness. A showroom's own site is small and there is no hurry.
DELAY = 0.5

#: What a product page's URL looks like on every storefront platform worth
#: naming. Only used to decide what to read first, so a false positive costs one
#: fetch and a false negative costs nothing.
PRODUCT_PATH = re.compile(r"/(products?|item|p|dp|sku|shop)/", re.I)


class _Extract(HTMLParser):
    """Pulls out the three things worth having: JSON-LD, OpenGraph, and links."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.jsonld: list[dict] = []
        self.meta: dict[str, str] = {}
        self.links: list[str] = []
        self._in_ld = False
        self._buffer: list[str] = []

    def handle_starttag(self, tag: str, attrs: list) -> None:
        a = dict(attrs)
        if tag == "script" and a.get("type") == "application/ld+json":
            self._in_ld = True
            self._buffer = []
        elif tag == "meta":
            key = a.get("property") or a.get("name")
            if key and a.get("content"):
                self.meta[key.lower()] = a["content"]
        elif tag == "a" and a.get("href"):
            self.links.append(a["href"])

    def handle_endtag(self, tag: str) -> None:
        if tag == "script" and self._in_ld:
            self._in_ld = False
            try:
                data = json.loads("".join(self._buffer))
            except json.JSONDecodeError:
                return
            # A page may declare one object, a list, or a @graph of them.
            items = data if isinstance(data, list) else [data]
            for item in items:
                if isinstance(item, dict):
                    self.jsonld.extend(
                        item.get("@graph", []) if "@graph" in item else [item]
                    )

    def handle_data(self, data: str) -> None:
        if self._in_ld:
            self._buffer.append(data)


def _first(value):
    """schema.org allows a value or a list of them almost everywhere."""
    if isinstance(value, list):
        return value[0] if value else None
    return value


def _text(value) -> str:
    value = _first(value)
    if isinstance(value, dict):
        value = value.get("name") or value.get("url") or value.get("@id") or ""
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _offer(node: dict) -> tuple[float | None, str, str]:
    offer = _first(node.get("offers")) or {}
    if not isinstance(offer, dict):
        return None, "INR", ""
    price = offer.get("price") or offer.get("lowPrice")
    try:
        price = float(str(price).replace(",", "")) if price is not None else None
    except ValueError:
        price = None
    # schema.org gives "https://schema.org/InStock"; the rest of the system uses
    # in_stock. Normalise here so a crawled product filters the same as an
    # imported one.
    raw = _text(offer.get("availability")).rsplit("/", 1)[-1]
    availability = re.sub(r"(?<!^)(?=[A-Z])", "_", raw).lower() if raw else "in_stock"
    return price, _text(offer.get("priceCurrency")) or "INR", availability


def product_from_jsonld(node: dict, page_url: str) -> Product | None:
    types = node.get("@type", "")
    types = types if isinstance(types, list) else [types]
    if not any(str(t).lower() == "product" for t in types):
        return None

    name = _text(node.get("name"))
    if not name:
        return None

    price, currency, availability = _offer(node)

    # Anything schema.org describes that is not a core field is still worth
    # keeping — brand, colour, material, size are exactly what a visitor asks
    # about, and which of them exist depends entirely on the vertical.
    extras = {}
    for key in ("brand", "color", "material", "size", "model", "sku", "gtin"):
        value = _text(node.get(key))
        if value:
            extras[key] = value

    return Product(
        id=_text(node.get("sku")) or _text(node.get("productID")) or _slug(name),
        name=name,
        category=_text(node.get("category")),
        price=price,
        currency=currency,
        description=_text(node.get("description"))[:600],
        url=_text(node.get("url")) or page_url,
        image=_text(node.get("image")),
        availability=availability,
        attributes=extras,
    )


def product_from_meta(meta: dict, page_url: str) -> Product | None:
    """OpenGraph fallback. Coarser than JSON-LD, but many storefronts emit
    `og:type=product` with a price and nothing else."""
    if meta.get("og:type") != "product":
        return None
    name = meta.get("og:title", "").strip()
    if not name:
        return None
    try:
        price = float(meta.get("product:price:amount", "").replace(",", ""))
    except ValueError:
        price = None
    return Product(
        id=_slug(name),
        name=name,
        price=price,
        currency=meta.get("product:price:currency", "INR"),
        description=meta.get("og:description", "")[:600],
        url=meta.get("og:url") or page_url,
        image=meta.get("og:image", ""),
    )


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:60]


def _json(url: str):
    """Fetch and parse JSON, or None. Used to ask a site a question it may not
    answer, so a failure here is an answer rather than an error."""
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            if "json" not in response.headers.get("Content-Type", ""):
                return None
            return json.loads(response.read(8_000_000))
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        return None


def _plain(markup: str) -> str:
    """`body_html` is a description with markup in it, not a document."""
    text = re.sub(r"(?is)<(script|style).*?</\1>", " ", markup or "")
    # A space, not nothing: `<p>one</p><p>two</p>` must not become "onetwo".
    text = re.sub(r"\s+", " ", html_module.unescape(re.sub(r"<[^>]+>", " ", text)))
    # Which then leaves "breathable ." wherever a tag closed before punctuation,
    # and this description is read aloud.
    return re.sub(r"\s+([.,;:!?])", r"\1", text).strip()


def category(raw: str) -> str:
    """One bucket per kind of thing, whatever the merchant typed.

    A real storefront is inconsistent about its own categories: this catalog
    carries "Kurta Sets" and "Kurta sets" as separate kinds, and "Sarees",
    "saree" and "Lehenga"/"Lehengas" likewise. Every split is a category a
    visitor cannot browse and a filter that silently returns half the stock —
    1,375 sarees in one bucket and 268 in another.

    Title case fixes the casing, and pluralising the last word fixes the rest.
    Naive on purpose: it is a display label and a search term, not a taxonomy,
    and "Rakhis" for "Rakhi" is the whole cost of being wrong.
    """
    text = re.sub(r"\s+", " ", (raw or "")).strip()
    if not text:
        return ""
    # Not str.title(): it capitalises after any non-letter, so "Men's Kurta"
    # comes back as "Men'S Kurtas" on a shop window. Only the first letter of
    # each word.
    words = [w[:1].upper() + w[1:].lower() for w in text.split(" ")]
    last = words[-1]
    if not last.lower().endswith("s"):
        words[-1] = last[:-1] + "ies" if last.lower().endswith("y") else last + "s"
    return " ".join(words)


def _is_internal(tag: str) -> bool:
    """A merchant's own bookkeeping, not something a visitor asks about.

    Real stores tag products for their own import pipelines — this catalog
    carries `Myntra_ID_43918230` and `Myntra_Scrape` beside `Blue` and
    `Jewellery`. Both kinds reach the model's prompt and the visitor's screen,
    and only one of them is about the product.
    """
    return bool(re.search(r"\d{4,}", tag)) or "_" in tag


def _listing(values) -> str:
    """Attributes are read aloud and indexed as text, so a list has to arrive as
    a sentence rather than as a Python repr."""
    return ", ".join(str(v) for v in values if v)


def shopify(base: str, limit: int = 5000) -> list[Product] | None:
    """Every product a Shopify store sells, from the JSON it already publishes.

    Shopify serves `/products.json` on every storefront, paginated, without a key.
    It is the same catalog the theme renders, and it carries strictly more than
    the JSON-LD on a product page does: every image rather than the first, every
    variant with its own price and stock, the tags, the vendor and the untruncated
    description. Crawling a 2,750-product store page by page to get less of it
    takes twenty minutes; this takes eleven requests.

    Returns None when the site is not Shopify, so the caller falls back to the
    ordinary crawl rather than treating "not a Shopify store" as a failure.
    """
    products: list[Product] = []
    # Not in products.json. A store that will not say gets the platform default
    # rather than a guess, because a price with the wrong symbol is a wrong price.
    currency = (_json(f"{base}/meta.json") or {}).get("currency") or "INR"

    for page in range(1, limit // 250 + 2):
        payload = _json(f"{base}/products.json?limit=250&page={page}")
        if payload is None:
            # Page one failing means this is not a Shopify store; a later page
            # failing means we already have most of a catalog and should keep it.
            return None if page == 1 else products
        batch = payload.get("products")
        if not isinstance(batch, list):
            return None if page == 1 else products
        if not batch:
            break
        products.extend(_shopify_product(node, base, currency) for node in batch)
        if len(products) >= limit:
            break
        time.sleep(DELAY)

    # A page is 250 whether or not the caller asked for that many.
    return products[:limit]


def _shopify_product(node: dict, base: str, currency: str) -> Product:
    variants = [v for v in node.get("variants", []) if isinstance(v, dict)]
    images = [i.get("src", "") for i in node.get("images", []) if isinstance(i, dict)]

    def _price(v):
        try:
            return float(v.get("price"))
        except (TypeError, ValueError):
            return None

    priced = [p for p in (_price(v) for v in variants) if p is not None]
    # The lowest, because a listing with sizes shows "from" and a visitor asking
    # "how much" before choosing a size is asking the cheapest way in.
    price = min(priced) if priced else None

    # Everything the core columns have no room for — and nothing else.
    #
    # `attributes` is not a junk drawer: `Product.as_line()` puts every pair into
    # the model's prompt, and the detail screen prints every pair to a visitor.
    # So this held image URLs once, which meant a passer-by read a wall of
    # cdn.shopify.com links off a shop window while the model spent its context
    # on them. Only things a person would actually ask about belong here.
    extras: dict = {}
    if node.get("vendor"):
        extras["brand"] = node["vendor"]
    tags = node.get("tags") or []
    keep = [t for t in (tags if isinstance(tags, list) else [tags]) if not _is_internal(t)]
    if keep:
        extras["tags"] = _listing(keep)
    for option in node.get("options", []):
        if isinstance(option, dict) and option.get("values"):
            extras[str(option.get("name", "option")).lower()] = _listing(option["values"])

    return Product(
        # The handle, not the numeric id: it is the URL slug, it is stable across
        # re-imports, and it is the same key the storefront uses.
        id=_text(node.get("handle")) or _slug(_text(node.get("title"))),
        name=_text(node.get("title")),
        category=category(_text(node.get("product_type"))),
        price=price,
        currency=currency,
        description=_plain(node.get("body_html", ""))[:600],
        url=f"{base}/products/{_text(node.get('handle'))}",
        image=images[0] if images else "",
        availability="in_stock" if any(v.get("available") for v in variants) else "out_of_stock",
        attributes=extras,
    )


def _fetch(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        if "html" not in response.headers.get("Content-Type", ""):
            return ""
        # Cap the read. One oversized page should not stall a whole crawl.
        charset = response.headers.get_content_charset() or "utf-8"
        return response.read(2_000_000).decode(charset, errors="replace")


def crawl(start: str, max_pages: int = 60) -> list[Product]:
    """Walk a site, same host only, and return every product found."""
    origin = urllib.parse.urlparse(start)
    base = f"{origin.scheme}://{origin.netloc}"

    # Ask the storefront for its catalog before walking it. A store that hands
    # over the whole thing in eleven requests should not be crawled page by page
    # for a subset of the same data.
    catalog_json = shopify(base, limit=max(max_pages, 250) * 20)
    if catalog_json:
        return catalog_json

    robots = urllib.robotparser.RobotFileParser()
    robots.set_url(f"{base}/robots.txt")
    try:
        robots.read()
    except Exception:
        # No robots.txt is permission by omission, not a reason to stop.
        pass

    seen: set[str] = set()
    queue = [start]
    found: dict[str, Product] = {}

    while queue and len(seen) < max_pages:
        url = queue.pop(0)
        if url in seen:
            continue
        seen.add(url)

        if robots.default_entry or robots.entries:
            if not robots.can_fetch(USER_AGENT, url):
                continue

        try:
            html = _fetch(url)
        except (urllib.error.URLError, TimeoutError, OSError, ValueError):
            continue
        if not html:
            continue

        parser = _Extract()
        try:
            parser.feed(html)
        except Exception:
            continue

        for node in parser.jsonld:
            product = product_from_jsonld(node, url)
            if product:
                found[product.id] = product

        if not parser.jsonld:
            fallback = product_from_meta(parser.meta, url)
            if fallback:
                found[fallback.id] = fallback

        for href in parser.links:
            link = urllib.parse.urljoin(url, href).split("#")[0]
            if link.startswith(base) and link not in seen and len(queue) < max_pages * 3:
                # Plain breadth-first spends the whole budget on whatever a
                # homepage links first, which is menus, collections and policy
                # pages. One storefront put its first product link at position
                # 60 of 127 with a budget of 60, so a site publishing perfect
                # JSON-LD on every product page returned nothing at all and
                # reported that it published no structured data. Pages that
                # look like products go to the front; the crawl still visits
                # everything, it just stops running out of budget in the menu.
                if PRODUCT_PATH.search(link):
                    queue.insert(0, link)
                else:
                    queue.append(link)

        time.sleep(DELAY)

    return list(found.values())


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 1

    products = crawl(argv[0], int(argv[1]) if len(argv) > 1 else 60)
    if not products:
        print("  no products found — the site may render them with JavaScript,")
        print("  in which case export a CSV or use a rendering crawler.")
        return 1

    upsert(products)
    print(f"  {len(products)} products indexed from {argv[0]}")
    for product in products[:10]:
        print(f"    {product.name[:44]:<46} {product.spoken_price()}")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main(sys.argv[1:]))
