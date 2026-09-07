"""Carry catalog changes between machines through the repository.

    python -m backend.snapshot export    # here, after changing the catalog
    python -m backend.snapshot apply     # there, and by update.ps1 on its own

Every data change so far has been a command run once per machine — prune the
catalog, rename the company — and that scales to as many installs as somebody
is willing to visit. `sync.py` solves this properly for cabinets that can reach
a platform over the network. This solves it for machines that cannot, using the
transport that already works between them: the git repository.

**What is exported is deliberately narrow.** Products, and the display name of
each org. Nothing else, and specifically not `users`, which lives in the same
SQLite file and holds email addresses and password hashes — the repository is
public, and a snapshot is a file anybody can read. The allowlist below is the
security boundary: it is an allowlist rather than a denylist precisely because
a new sensitive table must not become exportable by being added.

Avatars are not here either. They are tens of megabytes of video, and
`.gitignore` has kept them out of the repository since the day it had two
customers.

Applying is a mirror, not a merge — the same argument as `sync.pull_catalog`.
A merge cannot express a deletion, so pruning five thousand rows to two hundred
and fifty here would leave the other machine with all five thousand.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import sys

from backend import catalog

#: Written into the repository, so it must never hold anything private.
PATH = catalog.DB_PATH.parent / "snapshot.json"

#: Which product fields travel. The same shape `catalog.to_dict` produces,
#: minus the derived ones the receiving machine recomputes for itself.
FIELDS = (
    "id",
    "name",
    "category",
    "price",
    "currency",
    "description",
    "url",
    "image",
    "availability",
    "attributes",
)


def export() -> dict:
    """Write the snapshot. Returns a summary for the caller to print."""
    catalog.init()
    with catalog._connect() as conn:
        orgs = {
            r["id"]: r["name"]
            for r in conn.execute("SELECT id, name FROM orgs")
        }
        rows = conn.execute(
            "SELECT org_id, " + ", ".join(FIELDS) + " FROM products ORDER BY org_id, id"
        ).fetchall()

    products: dict[str, list[dict]] = {}
    for row in rows:
        item = {f: row[f] for f in FIELDS}
        try:
            item["attributes"] = json.loads(item["attributes"] or "{}")
        except (TypeError, ValueError):
            item["attributes"] = {}
        products.setdefault(row["org_id"], []).append(item)

    payload = {"orgs": orgs, "products": products}
    PATH.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return {"orgs": len(orgs), "products": sum(len(v) for v in products.values())}


def digest() -> str:
    """Fingerprint of the snapshot on disk, so a machine can tell whether it has
    already applied this one and skip rewriting its catalog every morning."""
    try:
        return hashlib.sha256(PATH.read_bytes()).hexdigest()[:16]
    except OSError:
        return ""


def apply(force: bool = False) -> str:
    """Bring this machine's catalog and company names in line with the snapshot.

    Returns a one-line status. Skips silently when the snapshot has not changed
    since the last apply, so the scheduled updater is not rewriting a database
    every morning to no effect.
    """
    if not PATH.exists():
        return "snapshot: none in this checkout, nothing to apply"

    marker = PATH.parent / ".snapshot-applied"
    current = digest()
    if not force:
        try:
            if marker.read_text(encoding="utf-8").strip() == current:
                return "snapshot: already applied"
        except OSError:
            pass

    try:
        payload = json.loads(PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        return f"snapshot: unreadable ({error}); keeping local"

    catalog.init()
    notes = []

    for org_id, name in (payload.get("orgs") or {}).items():
        with catalog._connect() as conn:
            if conn.execute("UPDATE orgs SET name = ? WHERE id = ?", (name, org_id)).rowcount:
                notes.append(f"{org_id} named {name!r}")

    for org_id, rows in (payload.get("products") or {}).items():
        products = [
            catalog.Product(
                id=r.get("id", ""),
                name=r.get("name", ""),
                category=r.get("category") or "",
                price=r.get("price"),
                currency=r.get("currency") or "INR",
                description=r.get("description") or "",
                url=r.get("url") or "",
                image=r.get("image") or "",
                availability=r.get("availability") or "in_stock",
                attributes=r.get("attributes") or {},
            )
            for r in rows
            if r.get("id") and r.get("name")
        ]
        before = len(catalog.all_products(org_id))
        # `replace` refuses an empty list, so a truncated snapshot cannot empty
        # a shop. Same guard, same reason as the network sync.
        written = catalog.replace(products, org_id)
        if written:
            notes.append(f"{org_id}: {before} -> {written} products")

    marker.write_text(current, encoding="utf-8")
    return "snapshot: " + ("; ".join(notes) if notes else "nothing to change")


def main(argv: list[str]) -> int:
    command = argv[0] if argv else "export"
    if command == "export":
        summary = export()
        print(f"wrote {PATH}")
        print(f"  {summary['products']} products across {summary['orgs']} orgs")
        print("  commit it, and the other machine picks it up on its next update")
        # Said plainly because getting it backwards is silent and costly: run
        # on a machine that receives updates, this overwrites the shared catalog
        # with that machine's own, and `apply` then reports success having
        # changed nothing. It cost exactly that once.
        print("")
        print("  NOTE: export runs on the machine you edit the catalog on.")
        print("  On a machine that runs update.ps1, run 'apply' instead —")
        print("  update.ps1 does it for you.")
        return 0
    if command == "apply":
        print(apply(force="--force" in argv))
        return 0
    print("usage: python -m backend.snapshot [export|apply]")
    return 1


if __name__ == "__main__":  # pragma: no cover
    sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(main(sys.argv[1:]))
