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
