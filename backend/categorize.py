"""File every product in the catalog, and say what could not be filed.

    python -m backend.categorize            # file everything again, then report
    python -m backend.categorize --report   # report only; change nothing

Nothing has to run this for new products. A product is filed the moment it is
written — by the website importer, a file upload, an edit in the studio or a
cabinet's sync — because all of them go through `catalog.upsert` or
`catalog.replace`, and those file what they write:

1. **Shelf.** The shop's own product type; where it gave none, the shelf one of
   the product's tags names.
2. **Colour and occasion**, from the tags.
3. **Department** — men's, women's, jewellery or accessories — from the tags,
   the shelf name, then the product's name.
4. **The shelf's answer.** A piece that does not say who it is for takes its
   shelf's department, when enough of that shelf is labelled and nearly all of
   it agrees.

This is for a catalog already on disk: after the rules change, or to see what a
shop's data leaves unanswered. The report is the useful half. A product this
cannot place is one whose own data does not say, and the list of them is a list
of things to fix at the source — a missing product type, a supplier who tags
nothing — rather than something a cleverer guess should paper over.
"""

from __future__ import annotations

import json
import sys

from backend import catalog

LABELS = {**catalog.DEPARTMENT_LABELS, "": "Not placed"}


def report(org_id: str) -> str:
    """One org's catalog as it is filed now, and what is not placed and why."""
    with catalog._connect() as conn:
        rows = conn.execute(
            "SELECT name, IFNULL(category, '') AS category, attributes, "
            "IFNULL(department, '') AS department FROM products WHERE org_id = ?",
            (org_id,),
        ).fetchall()

    placed: dict[str, int] = {}
    shelves: dict[str, set[str]] = {}
    # Per shelf: how many pieces say men's, women's, and how many say nothing.
    own: dict[str, dict[str, int]] = {}
    unplaced: dict[str, int] = {}
    for row in rows:
        placed[row["department"]] = placed.get(row["department"], 0) + 1
        shelves.setdefault(row["department"], set()).add(row["category"])
        try:
            attributes = json.loads(row["attributes"] or "{}")
        except (TypeError, ValueError):
            attributes = {}
        said = catalog.department_of(row["name"] or "", row["category"], attributes)
        counts = own.setdefault(row["category"], {})
        counts[said] = counts.get(said, 0) + 1
        if not row["department"]:
            unplaced[row["category"]] = unplaced.get(row["category"], 0) + 1

    lines = [f"{org_id}: {len(rows):,} products on {len({r['category'] for r in rows if r['category']})} shelves", ""]
    for department in (catalog.WOMEN, catalog.MEN, catalog.JEWELLERY, catalog.ACCESSORIES, ""):
        if placed.get(department):
            on = len({s for s in shelves[department] if s})
            lines.append(
                f"  {LABELS[department]:<16} {placed[department]:>7,}   "
                f"on {on} {'shelf' if on == 1 else 'shelves'}"
            )

    if unplaced:
        lines += ["", "Not placed, and why:"]
        for shelf, count in sorted(unplaced.items(), key=lambda kv: -kv[1]):
            lines.append(f"  {count:>6,}  {shelf or '(no shelf)':<28} {_why(shelf, own[shelf])}")
    return "\n".join(lines)


def _why(shelf: str, counts: dict[str, int]) -> str:
    """Why a shelf's unlabelled pieces were left unlabelled, in a line."""
    if not shelf:
        return "no product type, and no tag that names a shelf"
    men, women = counts.get(catalog.MEN, 0), counts.get(catalog.WOMEN, 0)
    labelled = men + women
    if not labelled:
        return "no piece on this shelf says who it is for"
    if labelled < catalog._SHELF_SPEAKS_FROM:
        return f"only {labelled} of its pieces say who they are for"
    # One decimal: this shop's Kurtas are 94.8% women's, and "95%" beside the
    # word "mixed" reads as a mistake when the bar is 95%.
    return (
        f"mixed: {women:,} women's, {men:,} men's "
        f"({max(men, women) / labelled:.1%}, under the {catalog._SHELF_AGREES:.0%} it takes)"
    )


def main(argv: list[str]) -> int:
    # A shelf or a product name can hold anything, and a Windows console is cp1252.
    sys.stdout.reconfigure(encoding="utf-8")
    catalog.init()
    if "--report" not in argv:
        print(f"filed {catalog.categorise():,} products again\n")
    with catalog._connect() as conn:
        orgs = [r["org_id"] for r in conn.execute("SELECT DISTINCT org_id FROM products ORDER BY 1")]
    if not orgs:
        print("the catalog is empty")
    for org_id in orgs:
        print(report(org_id) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
