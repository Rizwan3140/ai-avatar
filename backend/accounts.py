"""Who may change what.

Organisations, people, and the token that proves which org a request belongs to.

No auth library. `hashlib.scrypt`, `hmac` and `secrets` are all in the standard
library and are the parts that actually matter; a JWT dependency would buy header
parsing we do not need and a signature scheme we would still have to verify by
hand. The token below is a signed payload — same idea, twenty lines, no supply
chain.

**Bootstrap rule:** with no accounts on the machine the studio is open, because
that is today's single-kiosk install and demanding a login before anyone can
create one is a locked door with the key inside. The moment the first account
exists, every studio route requires a token — permanently. A fresh install is
open; an install that has ever had a user is not.

Tables live in the catalog database rather than a second file. One SQLite file is
easier to back up, and an org's products and an org's people belong together.
When Supabase arrives this module and `store.py` are what it replaces.
"""

import base64
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path

from backend import config, catalog

ROOT = Path(__file__).resolve().parent.parent
SECRET_FILE = config.DATA / "knowledge" / ".secret"

#: Long enough that a showroom manager is not logged out mid-edit, short enough
#: that a stolen laptop is not a permanent grant.
TOKEN_TTL = 14 * 24 * 3600

ROLES = ("owner", "editor", "viewer")

#: Every install has this org, and everything that existed before tenancy belongs
#: to it. Without a default, the first upgrade orphans the avatars already on disk.
DEFAULT_ORG = "default"


class AuthError(Exception):
    """Wrong credentials, expired token, or not permitted. Never says which of
    the three to an unauthenticated caller — that difference is a user enumeration
    oracle, and this login page is reachable from a showroom floor."""


@dataclass
class Principal:
    """A resolved caller: which person, which org, and what they may do."""

    user_id: str
    email: str
    org_id: str
    role: str

    @property
    def may_write(self) -> bool:
        return self.role in ("owner", "editor")


def _secret() -> bytes:
    """The signing key, generated on first use and kept on disk.

    Not derived from anything guessable and not committed. An env var wins when
    set, so a fleet behind one platform can share a key without sharing a file.
    """
    from_env = os.getenv("LUXORA_SECRET", "").strip()
    if from_env:
        return from_env.encode()

    if not SECRET_FILE.exists():
        SECRET_FILE.parent.mkdir(parents=True, exist_ok=True)
        SECRET_FILE.write_text(secrets.token_urlsafe(48), encoding="utf-8")
        try:
            SECRET_FILE.chmod(0o600)
        except OSError:
            pass  # Windows; the file is still outside the served directories.
    return SECRET_FILE.read_text(encoding="utf-8").strip().encode()


def _connect() -> sqlite3.Connection:
    # `catalog.DB_PATH` is read on every call rather than bound at import. It is
    # one database, and the module that owns the path owns it — binding a copy
    # here meant a test that redirected the catalog quietly kept writing accounts
    # into the real one.
    path = catalog.DB_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def init() -> None:
    with _connect() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS orgs (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                vertical TEXT DEFAULT '',
                created_at TEXT
            );
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                created_at TEXT
            );
            CREATE TABLE IF NOT EXISTS members (
                org_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                role TEXT NOT NULL,
                PRIMARY KEY (org_id, user_id)
            );
        """)
        conn.execute(
            "INSERT OR IGNORE INTO orgs (id, name, vertical, created_at) VALUES (?,?,?,?)",
            (DEFAULT_ORG, "Luxora", "", _now()),
        )


def _now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# --- passwords ---------------------------------------------------------------
# scrypt rather than a plain hash: a showroom password will be short and reused,
# so the only real defence is making each guess expensive.

_SCRYPT = dict(n=2**14, r=8, p=1, dklen=32)


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    key = hashlib.scrypt(password.encode(), salt=salt, **_SCRYPT)
    return f"{salt.hex()}${key.hex()}"


def check_password(password: str, stored: str) -> bool:
    try:
        salt_hex, key_hex = stored.split("$", 1)
        key = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt_hex), **_SCRYPT)
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(key.hex(), key_hex)


# --- tokens ------------------------------------------------------------------


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def issue_token(principal: Principal, ttl: int = TOKEN_TTL) -> str:
    payload = {
        "u": principal.user_id,
        "e": principal.email,
        "o": principal.org_id,
        "r": principal.role,
        "exp": int(time.time()) + ttl,
    }
    body = _b64(json.dumps(payload, separators=(",", ":")).encode())
    signature = hmac.new(_secret(), body.encode(), hashlib.sha256).digest()
    return f"{body}.{_b64(signature)}"


def verify_token(token: str) -> Principal:
    """Signature first, expiry second, and `compare_digest` so a forged token
    cannot be refined one byte at a time by timing the rejection."""
    try:
        body, signature = token.split(".", 1)
        expected = hmac.new(_secret(), body.encode(), hashlib.sha256).digest()
        if not hmac.compare_digest(_unb64(signature), expected):
            raise AuthError("not signed by this platform")
        payload = json.loads(_unb64(body))
    except AuthError:
        raise
    except Exception as exc:
        raise AuthError("malformed token") from exc

    if payload.get("exp", 0) < time.time():
        raise AuthError("session expired — sign in again")

    return Principal(
        user_id=payload["u"],
        email=payload.get("e", ""),
        org_id=payload["o"],
        role=payload.get("r", "viewer"),
    )


# --- accounts ----------------------------------------------------------------


def any_users() -> bool:
    """Whether this machine has ever had an account. Decides whether the studio
    is open (fresh single-kiosk install) or closed (a platform with people on it)."""
    init()
    with _connect() as conn:
        return conn.execute("SELECT 1 FROM users LIMIT 1").fetchone() is not None


def create_org(name: str, vertical: str = "") -> str:
    init()
    org_id = _slug(name) or secrets.token_hex(4)
    with _connect() as conn:
        # A second company called "Luxora Mumbai" must not silently join the first.
        taken = conn.execute("SELECT 1 FROM orgs WHERE id = ?", (org_id,)).fetchone()
        if taken:
            org_id = f"{org_id}-{secrets.token_hex(2)}"
        conn.execute(
            "INSERT INTO orgs (id, name, vertical, created_at) VALUES (?,?,?,?)",
            (org_id, name, vertical, _now()),
        )
    return org_id


def _slug(text: str) -> str:
    import re

    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:40]


def signup(email: str, password: str, org_name: str = "", vertical: str = "") -> Principal:
    """First account on a machine, or a new company on a platform.

    The password floor is here rather than in the route because it is a property
    of an account, not of one way of creating one.
    """
    init()
    email = email.strip().lower()
    if "@" not in email or len(email) < 5:
        raise AuthError("that does not look like an email address")
    if len(password) < 10:
        raise AuthError("password must be at least 10 characters")

    with _connect() as conn:
        if conn.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
            raise AuthError("could not create that account")

    org_id = create_org(org_name.strip() or email.split("@")[1], vertical)
    user_id = secrets.token_hex(8)

    with _connect() as conn:
        conn.execute(
            "INSERT INTO users (id, email, password_hash, created_at) VALUES (?,?,?,?)",
            (user_id, email, hash_password(password), _now()),
        )
        conn.execute(
            "INSERT INTO members (org_id, user_id, role) VALUES (?,?,?)",
            (org_id, user_id, "owner"),
        )
    return Principal(user_id=user_id, email=email, org_id=org_id, role="owner")


def login(email: str, password: str) -> Principal:
    init()
    email = email.strip().lower()
    with _connect() as conn:
        row = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        # Hash anyway when the user is unknown, so "no such account" and "wrong
        # password" take the same time and cannot be told apart from outside.
        stored = row["password_hash"] if row else hash_password("no-such-user")
        if not check_password(password, stored) or row is None:
            raise AuthError("email or password is incorrect")

        member = conn.execute(
            "SELECT org_id, role FROM members WHERE user_id = ? ORDER BY role LIMIT 1",
            (row["id"],),
        ).fetchone()

    if member is None:
        raise AuthError("this account belongs to no organisation")
    return Principal(row["id"], row["email"], member["org_id"], member["role"])


def add_member(org_id: str, email: str, password: str, role: str = "editor") -> Principal:
    """Invite by creating. A showroom team is three people, not three hundred, so
    an email round trip buys nothing an owner handing over a password does not."""
    init()
    if role not in ROLES:
        raise AuthError(f"role must be one of {', '.join(ROLES)}")
    email = email.strip().lower()
    if len(password) < 10:
        raise AuthError("password must be at least 10 characters")

    with _connect() as conn:
        row = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        if row:
            user_id = row["id"]
        else:
            user_id = secrets.token_hex(8)
            conn.execute(
                "INSERT INTO users (id, email, password_hash, created_at) VALUES (?,?,?,?)",
                (user_id, email, hash_password(password), _now()),
            )
        conn.execute(
            "INSERT OR REPLACE INTO members (org_id, user_id, role) VALUES (?,?,?)",
            (org_id, user_id, role),
        )
    return Principal(user_id, email, org_id, role)


def list_members(org_id: str) -> list[dict]:
    init()
    with _connect() as conn:
        rows = conn.execute(
            "SELECT u.id, u.email, m.role FROM members m "
            "JOIN users u ON u.id = m.user_id WHERE m.org_id = ? ORDER BY u.email",
            (org_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def remove_member(org_id: str, user_id: str) -> None:
    init()
    with _connect() as conn:
        owners = conn.execute(
            "SELECT COUNT(*) c FROM members WHERE org_id = ? AND role = 'owner'", (org_id,)
        ).fetchone()["c"]
        role = conn.execute(
            "SELECT role FROM members WHERE org_id = ? AND user_id = ?", (org_id, user_id)
        ).fetchone()
        # An org with no owner cannot be administered again by anyone.
        if role and role["role"] == "owner" and owners <= 1:
            raise AuthError("an organisation must keep at least one owner")
        conn.execute("DELETE FROM members WHERE org_id = ? AND user_id = ?", (org_id, user_id))


def get_org(org_id: str) -> dict | None:
    init()
    with _connect() as conn:
        row = conn.execute("SELECT * FROM orgs WHERE id = ?", (org_id,)).fetchone()
    return dict(row) if row else None


def set_vertical(org_id: str, vertical: str) -> None:
    """Fashion, electronics, hotel, automobile. Decides how the catalog and the
    persona read, not what code runs — the schema is vertical-agnostic already."""
    init()
    with _connect() as conn:
        conn.execute("UPDATE orgs SET vertical = ? WHERE id = ?", (vertical.strip(), org_id))


def list_orgs() -> list[dict]:
    init()
    with _connect() as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM orgs ORDER BY name").fetchall()]
