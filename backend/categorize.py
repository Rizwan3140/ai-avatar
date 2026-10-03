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


def summary(org_id: str) -> dict:
    """One org's catalog as it is filed: each department, its shelves and their
    counts, fullest first — and for the pieces placed nowhere, why.

    The studio's Products tab and the report below are both this. Counted in
    SQL rather than by reading every row: the studio asks on each change of
    filter, and at 25,000 products reading them all is the slow way to count.
    Only the shelves holding unplaced pieces are read row by row, to say why.
    """
    catalog.init()
    with catalog._connect() as conn:
        counted = conn.execute(
            "SELECT IFNULL(department, '') AS department, IFNULL(category, '') AS category, "
            "COUNT(*) AS n FROM products WHERE org_id = ? GROUP BY 1, 2",
            (org_id,),
        ).fetchall()
        puzzling = sorted({r["category"] for r in counted if not r["department"] and r["category"]})
        # Counted the way `_settle_departments` judges: by what the shop listed
        # each piece as, which is not always the shelf it is filed on. Per such
        # listing, how many say men's, women's or nothing — and per shelf, which
        # listing its unplaced pieces came under.
        own: dict[str, dict[str, int]] = {}
        stuck: dict[str, dict[str, int]] = {}
        for start in range(0, len(puzzling), 900):  # SQLite binds at most 999
            chunk = puzzling[start : start + 900]
            for row in conn.execute(
                "SELECT name, category, attributes, IFNULL(department, '') AS department "
                f"FROM products WHERE org_id = ? AND category IN ({', '.join('?' * len(chunk))})",
                [org_id, *chunk],
            ):
                try:
                    attributes = json.loads(row["attributes"] or "{}")
                except (TypeError, ValueError):
                    attributes = {}
                listing = catalog.listed_as(row["category"], attributes)
                said = catalog.department_of(row["name"] or "", row["category"], attributes)
                counts = own.setdefault(listing, {})
                counts[said] = counts.get(said, 0) + 1
                if not row["department"]:
                    on = stuck.setdefault(row["category"], {})
                    on[listing] = on.get(listing, 0) + 1

    def why(shelf: str) -> str:
        if not shelf:
            return _why("", {})
        # The listing most of this shelf's unplaced pieces came under.
        listing = max(stuck.get(shelf, {shelf: 0}).items(), key=lambda kv: kv[1])[0]
        reason = _why(listing, own.get(listing, {}))
        return reason if listing == shelf else f"listed as {listing}: {reason}"

    by_department: dict[str, list[dict]] = {}
    for row in counted:
        by_department.setdefault(row["department"], []).append(
            {"category": row["category"], "count": row["n"]}
        )
    departments = []
    for department in (catalog.WOMEN, catalog.MEN, catalog.JEWELLERY, catalog.ACCESSORIES, ""):
        shelves = sorted(by_department.get(department, []), key=lambda s: (-s["count"], s["category"]))
        if not shelves:
            continue
        if not department:
            for shelf in shelves:
                shelf["why"] = why(shelf["category"])
        departments.append({
            "id": department,
            "label": LABELS[department],
            "count": sum(s["count"] for s in shelves),
            "shelves": shelves,
        })
    return {
        "total": sum(r["n"] for r in counted),
        "shelves": len({r["category"] for r in counted if r["category"]}),
        "departments": departments,
    }


def report(org_id: str) -> str:
    """`summary`, as lines for a terminal."""
    filed = summary(org_id)
    lines = [f"{org_id}: {filed['total']:,} products on {filed['shelves']} shelves", ""]
    for department in filed["departments"]:
        on = len([s for s in department["shelves"] if s["category"]])
        lines.append(
            f"  {department['label']:<16} {department['count']:>7,}   "
            f"on {on} {'shelf' if on == 1 else 'shelves'}"
        )
    unplaced = next((d for d in filed["departments"] if not d["id"]), None)
    if unplaced:
        lines += ["", "Not placed, and why:"]
        for shelf in unplaced["shelves"]:
            lines.append(f"  {shelf['count']:>6,}  {shelf['category'] or '(no shelf)':<28} {shelf['why']}")
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
