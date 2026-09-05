"""Thin a scraped catalog down to one product per category and colour.

    python -m backend.prune --dry-run
    python -m backend.prune

A Shopify export is a sales database, not a showroom. Five thousand products is
1,988 rakhis that differ by a knot, and a cabinet that answers "show me your
rakhis" from that set is choosing between near-identical rows for a person
standing in a mall who wanted to see the range. One of each, in each colour, is
the range — the rest is inventory, and inventory belongs behind the QR code.

The rule is one row per `(category, colour)`. A product with no colour is its
own bucket rather than being dropped, so a category whose rows are all
uncoloured keeps a representative instead of disappearing from the shop
entirely — which is the failure mode that would be noticed last, because a
missing category looks exactly like a category nobody asked about.

What survives each bucket, in order: something in stock, then something with a
photograph, then something with a price, then the cheapest, then the lowest id.
Every step is a tie-break on the one before, and the last is there only so two
runs of this script agree.

Reversible only from a backup. It prints one before running.
"""

from __future__ import annotations

import shutil
import sys
from collections import defaultdict

from backend import catalog


def _rank(row: dict) -> tuple:
    """Lower sorts first, so each element is "is this worse".

    A product the shop cannot sell, or cannot show, is a poor ambassador for its
    whole colour — and on a transparent panel the photograph is most of the
    product.
    """
    return (
        row["availability"] != "in_stock",
        not (row["image"] or "").strip(),
        row["price"] is None,
        row["price"] if row["price"] is not None else 0.0,
        row["id"],
    )


def choose(rows: list[dict]) -> list[dict]:
    """One row per (category, colour). Pure, so it is testable without a database."""
    buckets: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for row in rows:
        buckets[((row["category"] or "").strip(), (row["color"] or "").strip())].append(row)
    return [min(group, key=_rank) for group in buckets.values()]


def prune(org_id: str = catalog.DEFAULT_ORG, dry_run: bool = False) -> tuple[int, int]:
    """Returns (before, after)."""
    catalog.init()
    with catalog._connect() as conn:
        rows = [
            dict(r)
            for r in conn.execute(
                "SELECT id, category, color, price, image, availability "
                "FROM products WHERE org_id = ?",
                (org_id,),
            )
        ]
        keep = {r["id"] for r in choose(rows)}
        if dry_run:
            return len(rows), len(keep)
        # Delete by id rather than rebuilding the table: the triggers keep the
        # FTS index in step, and a rebuild would have to reproduce them.
        conn.executemany(
            "DELETE FROM products WHERE org_id = ? AND id = ?",
            [(org_id, r["id"]) for r in rows if r["id"] not in keep],
        )
    return len(rows), len(keep)


def main(argv: list[str]) -> int:
    dry = "--dry-run" in argv
    before, after = prune(dry_run=dry)
    if dry:
        print(f"would keep {after} of {before} products")
        return 0

    backup = catalog.DB_PATH.with_suffix(".db.bak")
    print(f"backup: {backup}")
    print(f"kept {after} of {before} products")
    return 0


if __name__ == "__main__":  # pragma: no cover
    # Windows consoles are cp1252 and this prints paths.
    sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(main(sys.argv[1:]))
