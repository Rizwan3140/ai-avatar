"""Checks for the platform layer — accounts, tenancy, knowledge, try-on consent.

    ./.venv/bin/python -m backend.test_platform

No framework. `assert` and a counter are enough, and a test suite that needs
installing is a test suite that stops being run.

**Tenancy is tested by attempting the breach, not by reading the policy.** Every
isolation check below asks for another org's data through the normal API and
asserts it comes back empty. A test that asserts the filter is present in the SQL
passes forever after somebody deletes the filter and edits the test.

Everything runs against a temporary database so a run cannot touch a real
catalog. The modules take the path from a module-level constant, so the constant
is what gets pointed elsewhere.
"""

import sys
import tempfile
from pathlib import Path

_TMP = Path(tempfile.mkdtemp(prefix="luxora-test-"))

# Before importing anything that opens a connection at import time.
from backend import catalog, documents  # noqa: E402

catalog.DB_PATH = _TMP / "test.db"
documents.DB_PATH = catalog.DB_PATH

from backend import accounts, ingest, tryon  # noqa: E402

accounts.SECRET_FILE = _TMP / ".secret"

passed = failed = 0


def check(label: str, condition: bool) -> None:
    global passed, failed
    if condition:
        passed += 1
        print(f"  ok    {label}")
    else:
        failed += 1
        print(f"  FAIL  {label}")


def section(name: str) -> None:
    print(f"\n{name}")


def product(pid: str, name: str, **kw) -> catalog.Product:
    return catalog.Product(id=pid, name=name, **kw)


# --- passwords and tokens -----------------------------------------------------

section("credentials")

stored = accounts.hash_password("correct horse battery")
check("accepts the right password", accounts.check_password("correct horse battery", stored))
check("rejects the wrong one", not accounts.check_password("correct horse batteries", stored))
check("rejects an empty one", not accounts.check_password("", stored))
check("rejects a corrupt hash", not accounts.check_password("x", "not-a-hash"))
check(
    "salts, so the same password hashes differently",
    accounts.hash_password("same") != accounts.hash_password("same"),
)

who = accounts.Principal("u1", "a@b.com", "org-a", "owner")
token = accounts.issue_token(who)
check("a token round-trips", accounts.verify_token(token).org_id == "org-a")

try:
    # Flip a character in the payload. The signature must no longer match.
    body, sig = token.split(".", 1)
    forged = ("B" if body[0] != "B" else "C") + body[1:] + "." + sig
    accounts.verify_token(forged)
    check("a tampered token is refused", False)
except accounts.AuthError:
    check("a tampered token is refused", True)

try:
    accounts.verify_token(accounts.issue_token(who, ttl=-1))
    check("an expired token is refused", False)
except accounts.AuthError:
    check("an expired token is refused", True)

try:
    accounts.verify_token("nonsense")
    check("a malformed token is refused", False)
except accounts.AuthError:
    check("a malformed token is refused", True)

# A token signed with a different secret must not verify — otherwise every
# install on earth accepts every other install's tokens.
real_secret, accounts.SECRET_FILE = accounts.SECRET_FILE, _TMP / ".other-secret"
foreign = accounts.issue_token(who)
accounts.SECRET_FILE = real_secret
try:
    accounts.verify_token(foreign)
    check("another platform's token is refused", False)
except accounts.AuthError:
    check("another platform's token is refused", True)


# --- accounts -----------------------------------------------------------------

section("accounts")

check("a fresh machine has no users", not accounts.any_users())

alice = accounts.signup("alice@northwind.com", "a-long-enough-one", "Northwind")
check("signup returns an owner", alice.role == "owner")
check("and creates an org", accounts.get_org(alice.org_id) is not None)
check("the machine is no longer open", accounts.any_users())

for bad, why in [
    ("short", "a short password is refused"),
    ("", "an empty password is refused"),
]:
    try:
        accounts.signup("bob@northwind.com", bad, "Bob Co")
        check(why, False)
    except accounts.AuthError:
        check(why, True)

try:
    accounts.signup("not-an-email", "a-long-enough-one", "X")
    check("a non-address is refused", False)
except accounts.AuthError:
    check("a non-address is refused", True)

try:
    accounts.signup("alice@northwind.com", "a-long-enough-one", "Imposter")
    check("a duplicate email is refused", False)
except accounts.AuthError:
    check("a duplicate email is refused", True)

check("login works", accounts.login("alice@northwind.com", "a-long-enough-one").org_id == alice.org_id)
check("login is case-insensitive on email",
      accounts.login("ALICE@northwind.com", "a-long-enough-one").user_id == alice.user_id)

try:
    accounts.login("alice@northwind.com", "wrong")
    check("a wrong password does not log in", False)
except accounts.AuthError:
    check("a wrong password does not log in", True)

try:
    accounts.login("nobody@nowhere.com", "a-long-enough-one")
    check("an unknown account does not log in", False)
except accounts.AuthError:
    check("an unknown account does not log in", True)

contoso = accounts.create_org("Contoso")
carol = accounts.add_member(contoso, "carol@contoso.com", "another-long-one", "editor")
check("a member can be added", carol.role == "editor")
check("an editor may write", carol.may_write)
viewer = accounts.add_member(contoso, "vic@contoso.com", "another-long-one", "viewer")
check("a viewer may not write", not viewer.may_write)
check("members are listed", len(accounts.list_members(contoso)) == 2)

try:
    accounts.add_member(contoso, "dave@contoso.com", "another-long-one", "admiral")
    check("an unknown role is refused", False)
except accounts.AuthError:
    check("an unknown role is refused", True)

owner_of_contoso = accounts.add_member(contoso, "owner@contoso.com", "another-long-one", "owner")
try:
    accounts.remove_member(contoso, owner_of_contoso.user_id)
    check("the last owner cannot be removed", False)
except accounts.AuthError:
    check("the last owner cannot be removed", True)

accounts.remove_member(contoso, viewer.user_id)
check("other members can be removed", len(accounts.list_members(contoso)) == 2)


# --- tenancy, by attempting the breach ----------------------------------------

section("tenancy — catalog")

NORTH, SOUTH = alice.org_id, contoso

catalog.upsert(
    [
        product("titan-pro-16", "Titan Pro 16", category="laptop", price=189900.0,
                description="A powerful machine for video editing"),
        product("policy-x", "Northwind Exclusive", category="laptop", price=9900.0),
    ],
    NORTH,
)
catalog.upsert(
    [
        # Same id on purpose. Before the composite key this silently overwrote
        # Northwind's row and handed one customer another's product.
        product("titan-pro-16", "Contoso Titan Pro 16", category="laptop", price=1.0,
                description="A completely different machine"),
    ],
    SOUTH,
)

check("both orgs keep their own row", len(catalog.all_products(NORTH)) == 2)
check("the colliding id did not overwrite", len(catalog.all_products(SOUTH)) == 1)
check("north sees its own name", catalog.get("titan-pro-16", NORTH).name == "Titan Pro 16")
check("south sees its own name", catalog.get("titan-pro-16", SOUTH).name == "Contoso Titan Pro 16")
check("north cannot fetch south's exclusive", catalog.get("policy-x", SOUTH) is None)

found = catalog.search("laptop", org_id=SOUTH)
check("search returns only this org", all(p.name.startswith("Contoso") for p in found))
check("search finds something at all", len(found) == 1)
check(
    "an empty search is still scoped",
    len(catalog.search("", org_id=SOUTH)) == 1,
)
check(
    "a category filter is still scoped",
    len(catalog.search("", category="laptop", org_id=SOUTH)) == 1,
)
check(
    "a price filter is still scoped",
    len(catalog.search("", max_price=1000000.0, org_id=SOUTH)) == 1,
)
check(
    "full-text over another org's description finds nothing",
    catalog.search("video editing", org_id=SOUTH) == [],
)
check("north still finds it", len(catalog.search("video editing", org_id=NORTH)) == 1)

check("deleting is scoped", not catalog.delete("policy-x", SOUTH))
check("and works in the right org", catalog.delete("policy-x", NORTH))
check("categories are scoped", catalog.categories(SOUTH) == ["laptop"])


# --- knowledge ----------------------------------------------------------------

section("knowledge")

POLICY = """Returns Policy

Any item may be returned within thirty days of purchase, provided it is unused
and in its original packaging. Refunds are issued to the original payment method
within seven working days.

Delivery

We deliver across Maharashtra. Orders placed before two in the afternoon are
dispatched the same day.
"""

passages = documents.chunk(POLICY, "returns.txt")
check("prose becomes passages", len(passages) >= 1)
check("headings are captured", any(p.heading == "Returns Policy" for p in passages))
check("passage ids are unique", len({p.id for p in passages}) == len(passages))

documents.replace_source("returns.txt", passages, NORTH)
hits = documents.search("how many days to return something", org_id=NORTH)
check("a policy question retrieves the policy", any("thirty days" in p.text for p in hits))
check("another org retrieves nothing", documents.search("return", org_id=SOUTH) == [])
check("sources are listed", documents.sources(NORTH)[0]["source"] == "returns.txt")

# Re-uploading a shortened document must not leave the withdrawn paragraph behind.
documents.replace_source("returns.txt", documents.chunk("Returns\n\nNo returns.", "returns.txt"), NORTH)
check(
    "re-upload removes the old text",
    not any("thirty days" in p.text for p in documents.search("thirty days", org_id=NORTH)),
)
check("and indexes the new", documents.search("no returns", org_id=NORTH) != [])

long_text = "Sentence about warranties. " * 200
check("a long document splits", len(documents.chunk(long_text, "long.txt")) > 1)
check(
    "every piece is within the window",
    all(len(p.text) <= documents.CHUNK + 50 for p in documents.chunk(long_text, "long.txt")),
)
check("empty text yields nothing", documents.chunk("", "empty.txt") == [])
check("as_context is empty for no hits", documents.as_context([]) == "")
check("as_context names the source", "returns.txt" in documents.as_context(documents.search("returns", org_id=NORTH)))

documents.delete_source("returns.txt", NORTH)
check("a document can be deleted", documents.sources(NORTH) == [])


# --- ingest, new formats ------------------------------------------------------

section("ingest")


def docx(rows: list[list[str]] | None = None, paragraphs: list[str] | None = None) -> bytes:
    """A minimal but real .docx — a zip holding word/document.xml."""
    import io
    import zipfile

    W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"

    def para(text: str) -> str:
        return f'<w:p><w:r><w:t>{text}</w:t></w:r></w:p>'

    body = "".join(para(p) for p in (paragraphs or []))
    if rows:
        cells = "".join(
            "<w:tr>" + "".join(f"<w:tc>{para(c)}</w:tc>" for c in row) + "</w:tr>"
            for row in rows
        )
        body += f"<w:tbl>{cells}</w:tbl>"

    xml = f'<?xml version="1.0"?><w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>'
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("word/document.xml", xml)
    return buffer.getvalue()


rows, prose = ingest.read_docx(
    docx(
        rows=[["Name", "Price", "Fabric"], ["Linen Shirt", "2499", "linen"]],
        paragraphs=["About Us", "We have sold shirts in Pune since 1994."],
    )
)
check("a docx table becomes rows", rows == [{"Name": "Linen Shirt", "Price": "2499", "Fabric": "linen"}])
check("docx prose is kept separately", "Pune since 1994" in prose)
check("the table is not repeated in the prose", "Linen Shirt" not in prose)

products, prose = ingest.from_bytes(
    docx(rows=[["Name", "Price"], ["Linen Shirt", "2499"]]), "catalog.docx"
)
check("a docx table becomes products", products[0].name == "Linen Shirt")
check("and the price is parsed", products[0].price == 2499.0)

_, only_prose = ingest.from_bytes(docx(paragraphs=["Warranty", "Two years."]), "warranty.docx")
check("a prose docx yields no products", ingest.from_bytes(docx(paragraphs=["x"]), "a.docx")[0] == [])
check("and does yield prose", "Two years" in only_prose)

# A layout table — two columns, used for positioning, not data.
rows, _ = ingest.read_docx(docx(rows=[["Left"]]))
check("a one-column table is not a catalog", rows == [])

try:
    ingest.read_docx(b"this is not a zip")
    check("a corrupt docx is refused", False)
except ingest.UnsupportedFile:
    check("a corrupt docx is refused", True)

try:
    ingest.from_bytes(b"...", "presentation.pptx")
    check("an unsupported format is refused", False)
except ingest.UnsupportedFile:
    check("an unsupported format is refused", True)

md_products, md_prose = ingest.from_bytes(b"# Policy\n\nWe are open on Sundays.", "policy.md")
check("markdown is prose", md_products == [] and "Sundays" in md_prose)

csv_products, csv_prose = ingest.from_bytes(b"name,price\nDesk Lamp,1200\n", "items.csv")
check("csv is still products", csv_products[0].name == "Desk Lamp" and csv_prose == "")

txt_products, txt_prose = ingest.from_bytes(b"We close at nine.\nEvery day.\n", "hours.txt")
check("a prose .txt is not parsed as a table", txt_products == [])
check("and is kept as text", "close at nine" in txt_prose)

tabular_txt, _ = ingest.from_bytes(b"name,price\nMug,199\n", "export.txt")
check("a tabular .txt still becomes products", tabular_txt[0].name == "Mug")

result = ingest.absorb(b"# Hours\n\nWe open at ten.", "hours.md", NORTH)
check("absorb reports what it filed", result == {"source": "hours.md", "products": 0, "passages": 1})
check("and it is retrievable", documents.search("when do you open", org_id=NORTH) != [])
check("but not by the other org", documents.search("open at ten", org_id=SOUTH) == [])


# --- try-on -------------------------------------------------------------------

section("try-on")

try:
    tryon.try_on(b"\x89PNG fake", "https://example.com/shirt.jpg")
    check("no consent means no try-on", False)
except tryon.ConsentMissing:
    check("no consent means no try-on", True)

try:
    tryon.try_on(b"\x89PNG fake", "https://example.com/shirt.jpg", consent=False)
    check("consent=False is not consent", False)
except tryon.ConsentMissing:
    check("consent=False is not consent", True)

try:
    tryon.try_on(b"", "https://example.com/shirt.jpg", consent=True)
    check("an empty photo is refused", False)
except ValueError:
    check("an empty photo is refused", True)

try:
    tryon.try_on(b"x" * (tryon.MAX_IMAGE + 1), "https://example.com/s.jpg", consent=True)
    check("an oversized photo is refused", False)
except ValueError:
    check("an oversized photo is refused", True)

try:
    tryon.try_on(b"\x89PNG fake", "", consent=True)
    check("a product with no image is refused", False)
except tryon.TryOnUnavailable:
    check("a product with no image is refused", True)

# These three describe what happens with NOTHING configured, so they have to
# make that true rather than assume it. They asserted it instead, and passed only
# on a machine whose developer had no keys — the day a real FAL_KEY landed in
# .env the suite failed while the code was fine, which is the least useful thing
# a test can do.
_configured = {name: p for name, p in tryon._PROVIDERS.items() if p.available()}
tryon._PROVIDERS = {"local": tryon.LocalProvider()}

try:
    # With no keys set, the local provider is selected and refuses by name.
    tryon.try_on(b"\x89PNG fake", "https://example.com/s.jpg", consent=True)
    check("an unconfigured provider refuses loudly", False)
except tryon.TryOnUnavailable as exc:
    check("an unconfigured provider refuses loudly", "local try-on" in str(exc))

check(
    "a public garment url is passed through untouched",
    tryon.garment_source("https://example.com/shirt.jpg") == "https://example.com/shirt.jpg",
)
check(
    "a data uri is passed through untouched",
    tryon.garment_source("data:image/png;base64,AAA") == "data:image/png;base64,AAA",
)
try:
    # A catalog is customer-supplied, so an `image` of "../../.env" would be a
    # file-read primitive if the path were trusted.
    tryon.garment_source("../../.env")
    check("a traversing garment path is refused", False)
except tryon.TryOnUnavailable:
    check("a traversing garment path is refused", True)
try:
    tryon.garment_source("/products/does-not-exist.png")
    check("a missing garment file is refused", False)
except tryon.TryOnUnavailable:
    check("a missing garment file is refused", True)

check("status reports unavailability", tryon.status()["available"] is False)
check("status names the provider", tryon.status()["provider"] == "local")

# And the other half of the contract, which nothing covered: a configured
# provider is selected even though TRYON_PROVIDER still says "local". That
# fall-through is what makes setting one key enough, and it had no test at all.
class _Stub:
    name = "stub"

    def available(self):
        return True

    def swap(self, person, garment_url, description):
        raise AssertionError("not reached")


tryon._PROVIDERS = {"local": tryon.LocalProvider(), "stub": _Stub()}
check("a configured provider wins over the refusing default", tryon.provider().name == "stub")
check("and status says the photo leaves the room", tryon.status()["on_device"] is False)
check("and lists what is usable", tryon.status()["options"] == ["stub"])
check(
    "a data uri is built from the bytes",
    tryon._data_uri(b"\x89PNG\r\n").startswith("data:image/png;base64,"),
)
check(
    "a jpeg is labelled a jpeg",
    tryon._data_uri(b"\xff\xd8\xff\xe0").startswith("data:image/jpeg;base64,"),
)


# --- provider resolution ------------------------------------------------------

section("providers")

import importlib  # noqa: E402

from backend import config as _config  # noqa: E402


def resolved(llm: str, stt: str, key: str) -> tuple[str, str, bool]:
    """Re-resolve with the module's inputs swapped. The helpers read the module
    attributes at call time on purpose, so a deployment can be reasoned about
    without restarting anything."""
    old = (_config.LLM_PROVIDER, _config.STT_PROVIDER, _config.GROQ_API_KEY)
    _config.LLM_PROVIDER, _config.STT_PROVIDER, _config.GROQ_API_KEY = llm, stt, key
    try:
        return _config.llm_provider(), _config.stt_provider(), _config.hosted_models()
    finally:
        _config.LLM_PROVIDER, _config.STT_PROVIDER, _config.GROQ_API_KEY = old


check("nothing configured stays local", resolved("auto", "auto", "") == ("ollama", "whisper", False))
check("a groq key switches both", resolved("auto", "auto", "k") == ("groq", "groq", True))
check(
    "an explicit choice beats the key",
    resolved("ollama", "whisper", "k") == ("ollama", "whisper", False),
)
check(
    "half hosted is not hosted",
    resolved("groq", "whisper", "k")[2] is False,
)
check(
    "a cabinet with a key can still be pinned local",
    resolved("ollama", "whisper", "k")[:2] == ("ollama", "whisper"),
)

# --- store, ids ---------------------------------------------------------------

section("identifiers")

from backend import store  # noqa: E402

check("a normal id is accepted", store._safe_id("krish"))
check("hyphens and digits are accepted", store._safe_id("kiosk-2_a"))
check("traversal is refused", not store._safe_id("../../etc"))
check("a leading slash is refused", not store._safe_id("/etc/passwd"))
check("an empty id is refused", not store._safe_id(""))
check("uppercase is refused", not store._safe_id("Krish"))
check("a windows path is refused", not store._safe_id("..\\windows"))

try:
    store.avatar_dir("../secrets")
    check("avatar_dir refuses traversal", False)
except ValueError:
    check("avatar_dir refuses traversal", True)


section("grounding")

# The guard that stops a 3B model selling what we do not stock. Every "said"
# below is a real reply from llama3.2:3b to "do you have washing machines", with
# nothing in the catalog to ground it.
from backend import llm  # noqa: E402

for said in (
    "We do carry a selection of washing machines from a few different brands.",
    "We do carry a range of washing machines, including a top-of-the-line model.",
    "Yes, we have washing machines from Euroline for twenty-five hundred dollars.",
    "I can show you our range of home textiles if you'd like.",
):
    check(f"caught: {said[:44]}...", llm.ungrounded_claim(said, []))

check("a real refusal passes", not llm.ungrounded_claim(llm.REFUSAL, []))
check("so does a greeting", not llm.ungrounded_claim("Welcome to our showroom.", []))
check(
    "so does small talk",
    not llm.ungrounded_claim("I'm doing well, thank you for asking.", []),
)
# The guard is about groundedness, not vocabulary: with products retrieved, the
# same sentence is true and must be left alone.
check(
    "the same claim stands when the catalog backs it",
    not llm.ungrounded_claim("We do carry a few of those.", ["a product"]),
)

section("hosted, with a local fallback")

from backend import config, llm  # noqa: E402

# Which failures fall back and which stay loud. This is the whole distinction:
# a mall's wifi dropping should become the local model and a visitor who notices
# nothing, while a rejected key must not be hidden behind a slower answer that
# works. Getting it backwards means a broken deployment nobody investigates.
check("a rate limit falls back", 429 in config.RETRY_STATUS)
check("so does a gateway error", 502 in config.RETRY_STATUS)
check("a rejected key does NOT", 401 not in config.RETRY_STATUS)
check("nor does a forbidden one", 403 not in config.RETRY_STATUS)
check("nor a bad request", 400 not in config.RETRY_STATUS)
check(
    "the fallback error is catchable as its own kind",
    issubclass(config.ProviderUnreachable, RuntimeError),
)

# The switch has to happen before a single token is spoken. A generator that
# fails halfway has already had its words come out of the speaker, and starting
# again there gives one sentence two beginnings.
_local_said = ["from the local model."]


def _unreachable():
    raise config.ProviderUnreachable("wifi went away")
    yield  # pragma: no cover - generator, never reached


def _dead_halfway():
    yield "half a "
    raise config.ProviderUnreachable("dropped mid-stream")


llm._stream_groq = lambda messages: _unreachable()
llm._stream_ollama = lambda messages: iter(_local_said)
check(
    "an unreachable host is answered locally",
    list(llm._hosted_then_local([])) == _local_said,
)

llm._stream_groq = lambda messages: _dead_halfway()
try:
    list(llm._hosted_then_local([]))
    check("a mid-stream failure is not silently restarted", False)
except config.ProviderUnreachable:
    check("a mid-stream failure is not silently restarted", True)

# Partials are a local-only luxury: hosted, each one uploads the whole turn so
# far for a caption no visitor ever sees. Assert the rule, not this machine —
# the previous version compared against `stt_provider()` and started failing the
# day a real GROQ_API_KEY appeared in .env, with the code unchanged. Same trap
# the try-on checks above were in.
_was = config.STT_PROVIDER
config.STT_PROVIDER = "whisper"
check("partials are on for a local model", config.stt_provider() == "whisper")
config.STT_PROVIDER = "groq"
check("and off for a hosted one", config.stt_provider() != "whisper")
config.STT_PROVIDER = _was

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
