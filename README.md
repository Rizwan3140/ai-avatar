# Digital Human Engine

This is not a chatbot. It is a digital human installation.

The goal is to make a visitor walk away saying *"that felt like talking to a
person."* Every decision here is judged against that — if something does not
improve believability, it is not in v1.

## Run it

Nothing needs an API key and nothing calls out to the internet. Speech
recognition and the model both run on the machine — see [Hearing](#hearing).

You need **Node 20+**, **Python 3.11+**, **ffmpeg**, and **Ollama**.

### macOS

```bash
./setup.sh          # installs everything, picks a model that fits
./run.sh            # development,   http://localhost:5173
./run.sh kiosk      # single process, http://localhost:8000
```

`setup.sh` is safe to re-run. It sizes the model to the machine, because a 3B
model is only in this project's history because the first machine had 4 GB of
VRAM — and it conflates catalog facts, once giving one laptop another's battery
life.

| unified memory | model |
|---|---|
| 32 GB+ | `qwen2.5:14b` |
| 16 GB+ | `llama3.1:8b` |
| less | `llama3.2:3b` |

Override with `OLLAMA_MODEL` before running setup.

**Never copy `.venv` or `node_modules` between machines.** Both hold compiled,
platform-specific binaries. Copy the source and run `./setup.sh`.

### Windows

```powershell
# once
winget install Gyan.FFmpeg Ollama.Ollama OpenJS.NodeJS
ollama pull llama3.2:3b

python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
cd frontend; npm install; cd ..

# every time — two terminals
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --reload
cd frontend; npm run dev             # http://localhost:5173
```

### On the cabinet

Build once, then one server does everything — no Vite, no second terminal.

```bash
(cd frontend && npm run build)
./.venv/bin/python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

Open `http://<this-machine-ip>:8000` on the panel and press F11.

**The microphone will not work over a plain `http://` LAN address.** Browsers
only grant it to a secure context. On the panel's browser, add that exact origin
to `chrome://flags/#unsafely-treat-insecure-origin-as-secure` and relaunch. Or
drive the panel as a second display over HDMI, which keeps it on `localhost` and
sidesteps the whole problem.

```bash
(cd frontend && npm test)                   # 57 — conversation, navigation, audio, studio
./.venv/bin/python -m backend.test_catalog  # 27 — catalog, ingest, crawler
./.venv/bin/python -m backend.test_platform # 98 — accounts, tenancy, knowledge, try-on
./.venv/bin/python -m backend.test_api      # 52 — the same through the real routes
```

No test framework anywhere: `node --test` and a plain assert script. **Tenancy is
checked by attempting the breach**, not by reading the policy — every isolation
test asks for another org's data through the normal API and asserts it comes back
empty. A test that asserts the filter is present in the SQL passes forever after
somebody deletes the filter and edits the test.

## The footage

**She has no face yet.** `frontend/public/` holds a placeholder silhouette; the
five real assets and their hard technical constraints are specified in
[frontend/public/README.md](frontend/public/README.md). Until they land the whole
app — voice, barge-in, lifecycle — is still fully testable.

## Architecture

Every module publishes and subscribes to an event bus. **No module holds a
reference to another.** Conversation does not call TTS, Voice does not touch the
renderer, and the UI does not know speech exists.

```
                        Event Bus
                            │
   ┌──────────┬─────────────┼─────────────┬──────────┐
 Voice    Conversation   Digital        State        UI
 Engine     Engine        Human        Manager      Engine
                         Renderer
```

Three seams exist so each can be replaced without touching anything else:

| seam | today | later |
|---|---|---|
| `DigitalHumanRenderer` | `Mp4VideoRenderer` | LivePortrait · MuseTalk · Audio2Face · HeyGen |
| `AiProvider` | Claude, via `backend/llm.py` | Gemini · OpenAI · offline |
| Voice Engine | local Whisper in, browser speech out | ElevenLabs · Azure · Deepgram |

## Hearing

Speech recognition runs **locally**, in `backend/stt.py`, on faster-whisper.

The browser's own `SpeechRecognition` is not local — it streams audio to a
private Google endpoint whose API key is compiled into Google Chrome. Every
Chromium fork (Brave, Arc, Opera, Vivaldi) has the API but no key, so it fails
with `network` forever on a perfectly good connection. A kiosk cannot depend on
that, and an offline one cannot use it at all.

Instead the browser captures raw PCM through an AudioWorklet at 16 kHz, decides
where turns start and end from voice energy, and posts WAV to `/api/listen`.
Raw PCM rather than `MediaRecorder` because webm chunks after the first are not
independently decodable, so you cannot transcribe a half-finished sentence.

Measured on a 12-core CPU, int8, for 3.7 seconds of speech:

| | direct | through the API |
|---|---|---|
| `tiny.en` | 443 ms | — |
| `base.en` (default) | 849 ms | ~1.3 s final, ~1.2 s partial |

So the real wait after someone stops talking is `endOfTurnSilence` **plus about a
second**. Budget the whole path, not one number. `WHISPER_MODEL=tiny.en` roughly
halves it if the room is quiet and the speech is clear; `base.en` is the default
because a misheard question is unrecoverable while latency is only felt.

```
backend/
├── config.py           every external service, one place, nothing required
├── store.py            avatars + kiosks — files today, Postgres later
├── accounts.py         orgs, people, tokens. stdlib only, no auth library
├── catalog.py          products — SQLite FTS5, org-scoped, no vector database
├── documents.py        the company's own prose, for what no product row answers
├── ingest.py           CSV · JSON · TXT · MD · DOCX · PDF, filed by shape
├── avatar_provider.py  the lip-sync seam; only mp4 is wired
├── tryon.py            garment swap; consent enforced, photo never persisted
├── llm.py  stt.py      swappable behind unchanged interfaces
├── routes/platform.py  open — what a cabinet on a showroom floor may call
├── routes/studio.py    everything that writes, behind a token
└── main.py             composition root

frontend/src/
├── bus/            typed EventTarget wrapper, ~25 lines, no library
├── renderer/       the contract, the MP4 implementation, idle presence
├── voice/          owns the mic, recognition, TTS and interruption
├── provider/       stream(message) → text
├── conversation/   utterance in, reply events out
├── session/        boot · sleep · wake · end
├── state/          zustand, derived from the bus, read-only to the UI
├── studio/         the dashboard, lazy-loaded, never ships to a cabinet
└── ui/             one subtitle line, two controls, nothing else
```

## Topology

One codebase, two roles. `LUXORA_ROLE` decides what a process is.

```
   CLOUD  (Fly.io, Mumbai)              EDGE  (Mac mini at the cabinet)
   ────────────────────────             ──────────────────────────────
   avatars · kiosks · studio            conversation · models · footage
   no models, no GPU                    Whisper · Ollama · kiosk UI
   ~$5/month, sleeps when idle          survives the network going down
            │                                        │
            └──────── config sync, every 5 min ──────┘
                      JSON only, never media
```

**Why it splits there.** Everything in the conversation path needs a model resident
in memory. Deploying that to a cloud container means renting a GPU that idles
through a showroom's quiet hours — more than the entire rest of the platform costs.
So the models stay where the panel is, and the conversation keeps working when the
Wi-Fi does not.

**Sync writes into the same folders the app already reads**, so there is no cache
layer and no second code path: the local files *are* the cache. A kiosk that cannot
reach the platform serves whatever it last received.

**Media never crosses the wire.** Clips are ~11 MB each and egress out of an Indian
region bills at six times the US rate. Footage lives on each kiosk's disk, put there
by the asset pipeline.

| role | what it runs | when to use |
|---|---|---|
| `all` | everything, one process | development, single-kiosk installs. **The default.** |
| `edge` | conversation, models, footage, UI | the machine driving a panel |
| `cloud` | avatars, kiosks, studio | the deployed platform |

### Deploying the platform

```bash
fly launch --no-deploy     # once
fly deploy                 # thereafter
```

`fly.toml` targets **Mumbai (`bom`)** — the only Indian region among the usual
platforms; Singapore adds 50–100 ms. `min_machines_running = 0`, so it sleeps when
nobody is in the studio and a kiosk never notices, because it holds its own config.

The image installs `requirements-cloud.txt` — `fastapi` and `uvicorn`, nothing more.
Verified by running the cloud role in a venv containing only those two.

Then point each cabinet at it:

```bash
PLATFORM_URL=https://luxora-platform.fly.dev
LUXORA_ROLE=edge
VITE_KIOSK_ID=cabinet-1
```

## Avatars and kiosks

An avatar is a folder under `frontend/public/avatars/<id>/` holding its media and
an `avatar.json`. Several avatars, several kiosks and several companies work today
with no database server — everything is SQLite and files.

A cabinet identifies itself with `KIOSK_ID` and asks the API which avatar to show,
so re-pointing a screen at a different digital human needs no rebuild.
Unregistered kiosks fall back to the first ready avatar — a showroom screen showing
nothing is worse than one showing the wrong person.

**Avatar Studio** is at `/studio`: avatars, knowledge, campaigns, cabinets, team
and insights. Everything it shows is real state, so the gaps it reports are gaps in
the product rather than in the page.

`backend/persona.md` is the default persona for an avatar nobody has configured.

## Two routers, split by trust

A kiosk stands on a showroom floor, is physically reachable by the public, and has
no user to log in as. So the routes it calls are open and read-only; everything
that writes needs a token. The boundary is a file rather than a per-route
decision, which means you can see it in the import list.

```
routes/platform.py — open              routes/studio.py — needs a token
GET  /api/kiosk/{id}                   POST   /api/auth/signup · login
GET  /api/products  · /{id} · /qr      GET    /api/studio/avatars · kiosks
GET  /api/campaigns/{avatar}           PATCH  /api/studio/avatars/{id}
POST /api/analytics/viewed/{id}        POST   /api/studio/avatars/{id}/photo
GET  /api/tryon                        POST   /api/studio/import
POST /api/tryon/{product}              PUT    /api/studio/campaigns/{avatar}
                                       GET    /api/analytics · export
```

**The org is never a parameter.** It comes from the token, or from the avatar the
cabinet is showing. A tenant id on a query string is not a tenant id — it is a way
to read someone else's catalog. `catalog.search()` applies the filter
unconditionally, because that query feeds the model: a missed filter there is one
company's avatar quoting another company's prices out loud.

**With no accounts, the studio is open.** That is the single-kiosk install, and
demanding a login before anyone can create one is a locked door with the key
inside. Creating the first account closes it permanently and moves whatever was
already on disk to that org.

## What he is allowed to know

Two stores, because a catalog cannot answer "do you deliver to Pune".

| | holds | answers |
|---|---|---|
| `catalog.py` | products, core fields plus an attribute bag | "how much is the Titan Pro" |
| `documents.py` | passages of the company's own prose | "what is your returns policy" |

Both are SQLite FTS5 and both are org-scoped. Upload anything to
`POST /api/studio/import` — CSV, JSON, TXT, Markdown, DOCX or PDF — and it is
filed by shape rather than by extension: rows and headers become products, prose
becomes passages, and a brochure with a spec table in it becomes both.

A DOCX is read with `zipfile` and `xml.etree`, because a .docx *is* a zip of XML.
A PDF needs `pypdf`, and its **tables are deliberately not mined for products** —
recovering columns from glyph positions is guesswork, and a price silently
attached to the wrong product is worse than not importing at all.

## Virtual try-on

A photo of a visitor, wearing a garment from the catalog. Asynchronous — a photo
in, a photo out, ten seconds is fine — so it touches nothing in the conversation
stack, which is why it could be built without waiting for any of it.

A visitor can ask by voice ("can I try that on") or press the button on the
product they are looking at. Either way the consent screen opens; only the person
in front of it can go further.

**A kiosk that photographs members of the public is a different legal object from
one that answers questions.** Under India's DPDP Act and the GDPR:

- The camera does not open until someone has read what happens and agreed.
- The photo is held in memory and **never written to disk** — not a temp file, not
  a cache, not the event log. The log records *that* a try-on happened and for
  which product.
- The camera stops the instant the frame is taken, not when the render finishes.
- Declining is a button the same size as accepting.

`TRYON_PROVIDER=local` keeps the image inside the cabinet entirely and is the
preferred option for that reason alone, independent of cost. It is declared and
refuses by name; Replicate and fal.ai are written and need a key.

## Keys

Copy `.env.example` to `.env`. **Nothing in it is required** — the platform runs on
local models and files with all of it blank. Each key swaps one piece from local to
hosted. Startup prints what is wired:

```
  conversation
    on  Ollama       local, llama3.2:3b
    on  Whisper      local
    --  Anthropic    hosted LLM
    --  Deepgram     streaming STT
```

## Things that are deliberate

- **Videos never pause or restart during a session.** Poses are opacity
  crossfades. A frozen frame or a decode hitch reads instantly as software.
- **She speaks sentence by sentence**, not after the reply finishes. This is what
  puts first audio under a second.
- **Her own voice is filtered out of the microphone**, otherwise the kiosk
  transcribes itself and talks to itself.
- **Barge-in triggers on loudness, not on words.** Waiting for a transcript means
  talking over the visitor for a second, which is the most human-breaking thing
  this system can do.
- **The idle loop is deliberately made non-periodic.** An exact loop is caught by
  the eye within a minute.
- **Emotion is a seam that does nothing yet.** There is no emotional footage in
  v1, and inventing a visual response to populate an interface would cost
  believability.
- **Static elements drift a few pixels on a slow cycle.** A transparent OLED
  running for months permanently ghosts anything that never moves.

## Why white, on a transparent panel

The target hardware is a transparent OLED cabinet, and the instinct is to assume
a dark UI — black pixels are the transparent ones, so surely black is the
background.

Not here. **The cabinet is hollow with a white wall behind it.** Black pixels
reveal that wall, so black renders as physical white. This is what
`Docs/03-UIUX-Spec.md` means by `color.reveal.base: #000000` — black is how you
paint the cabinet, not how you hide it.

That makes the white canvas correct: it sits in a white cabinet, in front of a
white wall, and disappears into the surround. The **dark subject** is what reads.
Krish in a dark shirt and jeans is well suited to it; a light-coloured outfit
would vanish.

Watch his shoes. Bright white footwear against a white backdrop separates on an
LCD only through faint grey edges, and those edges are the first thing a
transparent panel loses.

## What is not finished

Written honestly, because a status page that reads better than the software is
worth nothing.

| | state |
|---|---|
| **The voice loop with a human microphone** | Written, unit-tested, **never once run by a person speaking**. Every attempt was blocked by something environmental. Half an hour on the Mac mini settles it, and until it is settled every estimate resting on it is provisional. |
| **Model accuracy** | Two causes found, both ours: a copyable example number in the persona, and `temperature` at `0.7` — a conversational setting applied to factual recall. At `0.2` prices are 9 of 9 and refusals 4 of 4 on the same 3B. Three to five samples per case, so a measurement rather than a guarantee. The Mac runs models ten times larger; that comparison has not been run. |
| **Lip-sync** | The seam exists on both sides and has no second implementation, deliberately. Spike 0 — MLX versus MuseTalk on an M4 Pro — is unrun, and building a renderer for a provider nobody has written is a factory for one product. |
| **Three of four clips** | Missing, so listen, think and speak all fall back to idle and he does not change when spoken to. That needs footage, not code. |
| **Try-on has never produced an image** | Consent, camera, endpoint and refusals are all exercised. The two hosted providers are written against published APIs and have never run — that needs a key. Local is declared and refuses. |

Everything else in the scope is built: tenancy, accounts and roles; catalog and
document knowledge; ingest from six formats; product, campaign, cabinet and team
management; idle advertising; analytics; and the showroom experience itself.
