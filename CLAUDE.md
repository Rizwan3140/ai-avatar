# Luxora — working context

Read this before changing anything. It exists so decisions already made are not
re-argued, and so bugs already found are not reintroduced.

## What this is

An AI digital human for a **transparent OLED showroom cabinet**. A visitor walks
up, talks, asks for products, sees them appear, and asks about them — by voice.
It is not a chatbot with a face; the illusion that a person is standing inside the
display is the product, and any change that weakens it is the wrong change.

Full scope: `Docs/`, and the plan at
`C:\Users\admin\.claude\plans\avatar-engine-v1-giggly-cerf.md`.

## Run it

```bash
./setup.sh        # once — installs, sizes the model to the machine, writes run.sh
./run.sh          # dev: API :8000, Vite :5173
./run.sh kiosk    # what a cabinet runs: one process, built UI
./run.sh cloud    # the platform role
```

```bash
(cd frontend && npm test)                   # 96 checks
./.venv/bin/python -m backend.test_catalog  # 110 — catalog, ingest, crawler
./.venv/bin/python -m backend.test_platform # 217 — accounts, tenancy, knowledge, try-on
./.venv/bin/python -m backend.test_api      # 124 — the same through the real routes
./.venv/bin/python -m backend.tts           # voice: cloning, conversion, refusals
```

547 checks total. **Never run the Python suites through `unittest`** — they are
assert scripts, not `TestCase` classes, so discovery reports zero tests and looks
like a pass.

`test_platform` checks the modules; `test_api` checks that the routes are wired to
them. Both exist because a module can be perfectly tenant-safe behind a route that
forgot to ask who was calling.

Three `ponytail:` markers are outstanding — the echo filter in
`frontend/src/logic.ts`, idle-loop periodicity in
`frontend/src/renderer/animation.ts`, and the single global transcription lock in
`backend/stt.py`. Each names its ceiling and its upgrade path. A fourth, in
`backend/memory.py`, has been paid.

## Hardware, actual

- **Mac mini M4 Pro, 48 GB**, drives the 52" panel at **2160×3840**. This is the
  kiosk. It runs the models. Because it drives the panel itself, the app is on
  `localhost` and the microphone works with no HTTPS and no Chrome flags.
- Development has also happened on a Windows box with an RTX 2050 (4 GB). That
  card is why `llama3.2:3b` is the default — a constraint that no longer applies
  on the Mac.

## Architecture

**Event bus.** Modules publish and subscribe; none holds a reference to another.
`bus/events.ts` is the whole vocabulary. Adding a feature usually means adding an
event, not a dependency.

**Three seams**, each of which has already paid for itself:

| seam | swapped so far |
|---|---|
| `backend/llm.py` | Anthropic → Ollama, one file |
| `backend/stt.py` | browser speech → local Whisper, one folder |
| `backend/avatar_provider.py` | mp4 today; Simli/HeyGen/Anam declared |
| `backend/store.py` | files today; Supabase replaces this module alone |
| `backend/tryon.py` | Replicate and fal wired; local declared and refusing |

**Two roles, one codebase.** `LUXORA_ROLE=edge|cloud|all` (default `all`).
Everything needing a model is edge-only, because a cloud container running
inference means renting a GPU that idles through a showroom's quiet hours.
Imports are role-conditional — **never import `stt`/`llm` at module level in
shared code**, or the cloud image pulls in faster-whisper.

**Sync writes into the folders the app already reads**, so there is no cache layer:
the local files *are* the cache, and a kiosk that loses the network keeps serving
its last state. A cabinet pulls `/api/kiosk/{id}` — **its own row and nothing
else**. It used to pull every avatar on the platform, which was harmless with one
customer and became a cross-tenant leak with two.

**Two routers, split by trust.** `routes/platform.py` is what a cabinet may call:
it reads, and it records that something was looked at. `routes/studio.py` is
everything that writes, behind a token. A kiosk is physically reachable by the
public and has no user to log in as, so the boundary is a file rather than a
per-route decision.

**Every row carries an `org_id`,** and it always comes from the token or from the
avatar the cabinet is showing — never from a parameter the caller chooses. A
tenant id on a query string is not a tenant id, it is a way to read someone
else's catalog. `catalog.search()` applies the filter unconditionally rather than
as one branch among several, because that query feeds the model: a missed filter
there is not a leak in a dashboard, it is one company's avatar quoting another
company's prices out loud.

## Decisions already made — do not relitigate

- **White background, dark subject.** The cabinet is hollow with a white wall
  behind, so black pixels reveal that wall. Black renders as physical white. This
  looks backwards for a transparent panel and is correct for *this* one.
- **Local inference, cloud only for content.** Conversation must survive the
  network dropping.
- **SQLite FTS5, not a vector database.** Built into Python. Embeddings go behind
  `catalog.search()` the day keyword search measurably fails, not before.
- **The crawler reads schema.org JSON-LD**, it does not scrape layout.
- **QR is rendered locally** by segno. A hosted QR was the one element that went
  blank when the network dropped.
- **Videos never pause or seek during a session.** Poses are opacity crossfades. A
  frozen frame or a decode hitch reads instantly as software.
- **`setEmotion()` is deliberately inert.** No emotional footage exists; inventing
  a visual response to populate an interface is the manifesto inverted.
- **The idle clip plays while idle.** It did not, for most of this project:
  `idle()` set `live: false`, which zeroes every video and shows the poster, so an
  avatar with all four clips never showed `idle.mp4` at all and an avatar with only
  idle showed it exclusively while *speaking*. Three things written later assume it
  runs — the footage brief sizing idle at 25-40s because "a short idle loop is a
  loop the eye catches", `conform_footage.py` ping-ponging for a seamless loop, and
  `startIdlePresence` jittering the rate to defeat periodicity. A still photograph
  on a transparent panel reads as a mannequin. `live` is now false only in sleep.
- **Mute releases the microphone, it does not ignore it.** `stopListening` stops
  the tracks and closes the AudioContext, so the browser's recording indicator goes
  out and a visitor can *check* the cabinet is not listening rather than trusting a
  caption. In a room full of strangers that is the only version worth shipping.
  Muting parks them at idle — standing attentively at someone who just switched the
  microphone off is the unsettling version.
- **No auth library, no ORM, no HTTP client.** `hashlib.scrypt`, `hmac` and
  `secrets` are the parts of auth that matter and are stdlib; `sqlite3` holds a
  few thousand rows without complaint; `urllib` makes every outbound call here.
  See the bottom of `requirements.txt` for what was deliberately not added.
- **A machine with no accounts leaves the studio open.** That is today's
  single-kiosk install, and demanding a login before anyone can create one is a
  locked door with the key inside. The first account closes it permanently, and
  whatever was already on disk moves to that org rather than disappearing behind
  a tenant filter.
- **The open studio is a property of the console, not of the database.** With no
  accounts, `principal()` hands back an owner - but only to a caller on
  loopback. "No accounts exist" had been standing in for "whoever is asking is
  sitting at this machine", which held right up until `start.ps1` put a
  Cloudflare tunnel over the whole app at every logon. Creating the first
  account is bound the same way, because claiming an install is something you
  do at the machine.
- **`LUXORA_OPEN_STUDIO=1` drops the loopback half of that.** Off unless set,
  and only while no account exists — once somebody signs up the branch is gone
  and the flag means nothing, because it defers the first account rather than
  waving past a password. It still cannot claim an install: signup stays bound
  to the machine. With it on, every studio route answers whoever reaches the
  port as a full owner, so it belongs on a bench or during a setup session, not
  on a showroom network with a tunnel over it. Asked for while a second machine
  was being set up; delete the line from `.env` to put the door back.
- **A token proves identity; the database decides rights.** `principal()` reads
  the role from `members` on every request. A signed token's role is as true a
  fortnight later as the day it was minted, so removing somebody used to leave
  their browser working until it expired. The other half is `users.token_version`,
  stamped into the token and re-read on every request: changing a password ends
  every session opened with the old one, which is what makes changing it after
  somebody learned it mean anything. Per account, so it signs out one person and
  not an install.
- **A cabinet follows release tags, not the branch.** `update.ps1` runs at
  every logon, so whatever `master` pointed at when a cabinet woke up was
  executed on it - which made "can push to master" and "can run code in every
  showroom" one sentence. A tag is a deliberate act; a push is not. It picks the
  highest version tag (version order, not alphabetical: `v1.10.0` beats
  `v1.9.0`, and `-SelfTest` checks that without touching the network), ignores
  anything that is not a plain version, and falls back to the branch **only**
  while no tag exists - not when GitHub is unreachable, because a blip that
  puts a cabinet back on `master` is the behaviour being removed. Cut a tag to
  ship. This is not signature verification; the remaining half is a protected
  branch and signed tags, which is a GitHub setting rather than a patch.
- **Consent is a nonce, not a flag.** `?consent=1` was a constant the browser
  typed into every request: the check was real and the value proved nothing,
  and there was no record tying an agreement to a photograph. The token is
  issued when the visitor presses yes, spent once at the last moment before the
  image is used, and written to the event log. A failed lookup does not burn it.
- **An avatar id is unguessable, because it is a bearer credential.**
  `org_for()` resolves an org from whichever avatar id the public API is
  handed. Slugging the display name made that free to guess - a company called
  Northwind Retail was `northwind-retail` on every install. New ids carry six
  random hex characters; existing ones are untouched, because the id is the key
  on every kiosk row, campaign folder and clip on disk.
- **A visitor's photograph is never written to disk.** Not a temp file, not a
  cache, not the event log — the log records that a try-on happened and for which
  product. Consent is a required parameter with no default. This is DPDP/GDPR
  scope, not a preference, and it is why local try-on is the preferred provider
  independent of cost.
- **A PDF's tables are not mined for products.** Recovering columns from glyph
  positions is guesswork, and a price silently attached to the wrong product is
  worse than not importing at all, because nobody checks what looked like it
  worked. Prose from a PDF, yes; a catalog from a PDF, export a CSV.
- **Keyword search over documents, not embeddings.** Same argument as the
  catalog: the corpus is a policy page and a brochure. Embeddings go behind
  `documents.search()` the day retrieval measurably misses — a day identifiable
  from the event log, which now records how often an answer used a document.

## Gotchas that have already cost time

- **Windows console is cp1252.** Printing `→`, `—` or `₹` crashes a script. Use
  ASCII in console output, or `sys.stdout.reconfigure(encoding="utf-8")`.
- **`crypto.randomUUID()` needs a secure context.** Over plain http on a LAN it is
  `undefined`. `session.ts` has a fallback; do not remove it.
- **`getUserMedia` also needs a secure context** — `localhost` qualifies, a LAN IP
  does not without a Chrome flag.
- **Limited-range H.264 decodes white to ~`#EBEBEB`**, which puts a grey rectangle
  on a white page and looks exactly like a CSS bug. `conform_footage.py` forces
  full range; always verify on the *decoded* frame.
- **Unquoted commas in customer CSVs** silently truncate descriptions.
  `ingest.py` sews the overflow back on.
- **`one` is a pronoun, not an ordinal.** "The last one", "the premium one". It
  was registered as an ordinal and hijacked half of product navigation.
- **A passing test suite does not mean anything calls the code.**
  `navigation.context()` was written, tested, documented and never invoked, so the
  model never knew what was on screen.
- **`from x import CONST` binds a copy.** `accounts.py` imported the database path
  from `catalog`, so a test that redirected `catalog.DB_PATH` kept writing real
  accounts into the real database. Import the module, read the attribute.
- **Two customers slug the same product id.** "Titan Pro 16" becomes
  `titan-pro-16` for everyone who sells one, so `products` is keyed on
  `(org_id, id)`. A single-column key silently overwrote the first company's row.
- **"One" is not the only trap word — "try" is another.** "Try the other one" is
  navigation; "try it on" opens a camera on a member of the public. The try-on
  rule requires the preposition and excludes "try to".
- **An example number in the prompt becomes the answer.** The persona said
  `Use plain spoken numbers — "twelve ninety-nine"`, and the 3B model quoted
  twelve ninety-nine as the price of *every* product — a laptop at ₹1,899 and a
  shirt at ₹2,499 included. This was read as the model fabricating for months.
  Never put a sample value in a prompt that shares a shape with real data.
- **Temperature is not a personality setting.** `0.7` reads as a sensible
  conversational default and quietly costs factual accuracy: prices were wrong 2
  times in 5 with the correct product alone in the prompt. Warmth belongs in the
  persona; sampling temperature only buys variation, and a price is the one place
  variation is a lie. `0.2`.
- **A brevity cap is not brevity.** Lowering `num_predict` to force short answers
  just truncates them mid-word — the same "stopped mid-sentence" complaint from
  the other direction. The prompt does the shortening; the cap only stops a
  runaway.
- **Barge-in must not cut mid-word.** The original note said talking over the
  visitor was the most human-breaking failure, so interruption called
  `speechSynthesis.cancel()`. In a real room a cough, a passer-by or their own
  echo all cross the loudness floor, and being chopped mid-word reads as a crash.
  They now finishes the sentence in flight and starts no more. Reversed after being
  used, not after being reasoned about.
- **Small models need prohibitions, not policies.** "Say plainly that we do not
  carry it" was answered with "we do carry washing machines" three times in four.
  Rewritten as flat "Do not say we carry it. Do not offer to show it." it refuses
  four times in four.
- **`frontend/public/` is copied into `dist/` at build time.** Replacing a
  poster, clip or campaign image does nothing until `npm run build` runs again.
  Cost two rebuilds to notice.
- **A `<video>` poster fills the frame, so a bad background hides.** The poster
  was `#FDFDFD` across 93% of the frame and invisible under `fit: cover`; the
  moment `contain` put true white beside it, a grey rectangle appeared. The
  pipeline's own check sampled one corner pixel and reported "true white".
- **A muted cabinet reports `status: 'idle'`,** because that is what it is. Any
  control derived from status alone therefore disables itself during a mute —
  including the one button that undoes the mute. `Controls.tsx` consults `muted`
  as well as `status` for exactly this reason. The same shape catches the sleep
  timer, which arms on idle and so eventually sleeps a cabinet left muted; that
  one is correct and deliberate.
- **Navigation selects, then the same utterance's results arrive.** "Tell me
  about the linen shirt" opened the detail view and bounced straight back to the
  grid, because `PRODUCTS_SHOWN` reset the selection navigation had just made. A
  selection now survives if the product is still in the new list.
- **A rhyme is not a typo.** difflib scores on characters shared anywhere, so
  "laptops" hit `Tops` and "things" hit `Rings`, both at 0.727 against a 0.7
  cutoff. A fuzzy shelf match now has to share its first letter — a mishearing
  keeps one, a rhyme does not. Raising the cutoff only moves the next collision.
- **Nothing to search for is not nothing to search by.** An empty query browses
  the catalog, which is right; a sentence whose every word is a stopword was
  taking the same path, so "hi there how are you" put eight products on screen.
- **STOPWORDS is not a generic English list** — it is the words people ask
  *with* in a showroom, and every one of them appears in marketing copy. Terms
  are OR-ed, so one incidental hit returns a product: "What are your opening
  hours?" put a garment on the panel, and both offenders were prompt chips.
  Words that could ever be shopped for stay out ("party", "wedding", "new").
- **Contractions split into words nobody said.** "isn't" becomes "isn" — three
  characters, in no stopword list, and it matched "Dressing up isn't a hassle".
- **One term of several is not a match.** Asked for a "mobile phone" the shop
  offered a potli and a jacket, each matching one word because both blurbs
  mention keeping your phone in them. A single-term query is still exempt.
- **A shelf inside a longer word is not a shelf.** `ungrounded_claim` matched
  category names as substrings, so "lap-tops" contained "tops" and a fabricated
  claim read as grounded. Same shape as `one` being registered as an ordinal.
- **Naming a real shelf does not license the whole sentence.** "Do you sell
  shoes" was answered "We do sell shoes, including Accessories, Bangles" — two
  real shelves and one lie. A noun the visitor supplied, repeated inside a claim
  of stock, has to be a shelf or a product retrieved that turn.
- **ffmpeg is not optional any more, and PATH is not where to look for it.**
  The studio's clip upload runs `conform_footage` server-side and an advert
  recorded on a phone is transcoded before a browser will play it — so a
  cabinet needs ffmpeg, not just a workstation. `shutil.which` was the whole
  search, and on a machine where nobody could run an installer it found nothing:
  every video upload answered "ffmpeg is not on this machine's PATH" and the
  studio looked broken. `conform_footage.ffmpeg_exe()` is the one resolver —
  `LUXORA_FFMPEG`, then PATH, then `tools/`, then where an installer would have
  put it — and `tools/get-ffmpeg.ps1` fetches the binary without administrator.
  It checks size, not just existence: a half-finished download is a real file at
  the right path and finding it turns a clear message into an opaque crash.
- **`accept` hides files rather than rejecting them.** The ads picker listed
  `video/mp4,video/webm`, so the .mov a phone records was greyed out in the file
  dialog — unpickable, with no error anywhere. Client-side filtering makes a
  refusal invisible; the server is the only place that can say why. Pickers take
  `video/*` and `save_media` converts what a browser cannot play.
- **An empty result must not empty the screen.** A turn matching nothing emitted
  `PRODUCTS_CLEARED`, so every sentence that was not itself a search swept the
  merchandise away — a visitor asking "what is it made of" watched the saree
  vanish while they asked. Clearing is deliberate: a spoken "clear", or Back.

## Open risks

1. **The voice loop has never been run with a human microphone.** Not once, across
   the whole project. Everything else rests on it. Half a day to settle.
2. **The 3B model fabricated — and none of it was the model.** Two causes, both
   ours. The persona supplied a copyable example number, so every price came back
   as that number. Then, with the prompt fixed, prices were still only 3 in 5 —
   because `temperature` was `0.7`, a conversational setting applied to factual
   recall, and the model invented a price with the correct one alone in its
   prompt. At `0.2` prices are 9 of 9 and refusals hold 4 of 4 on the same
   `llama3.2:3b`. Three to five samples per case, so a measurement rather than a
   guarantee, and a larger model on the Mac is still the right answer — but
   "the model fabricates" was never the whole story.
3. **Local lip-sync on Apple Silicon is unproven.** MuseTalk has no official macOS
   support; MLX is the better bet. Spike 0 in the plan, still unrun. The seam is
   in place — `DigitalHumanRenderer` in the frontend, `avatar_provider.py` in the
   backend — and deliberately has no second implementation behind it yet. A
   `HybridRenderer` switching between mp4 and a renderer nobody has written is a
   factory for one product.
4. **Try-on has never produced an image.** The consent flow, the endpoint, the
   camera and the refusals are all exercised; the two hosted providers are
   written against published APIs and have never run, because that needs a key.
   Local — the one that keeps the photo in the cabinet — is declared and refuses.
5. **Clips are complete for one avatar, not the other.** `satya` has all four —
   idle, listen, think, speak — and changes as the conversation moves. `krish`
   has only `idle.mp4` and falls back to it for every pose, so they do not change
   when spoken to. That gap needs footage, not code.

## How to work here

Ponytail and YAGNI, actively applied. Stdlib before a dependency, a native
platform feature before a library, deletion over addition. When something is
deliberately simplified past a real ceiling, leave a `ponytail:` comment naming
the ceiling and the upgrade path — and **when that ceiling is reached, pay it**.
The multi-kiosk conversation bug was a `ponytail:` marker that said "add session
IDs the day a second kiosk shares this backend", and that day arrived unnoticed.

Non-trivial logic leaves one runnable check behind. No test framework: `node --test`
and a plain assert script are enough.

Report status honestly, including when a previous claim was wrong.
