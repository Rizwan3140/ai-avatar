# Cloud / Online Run Guide

Deploying Luxora so a reviewer can open a URL and use it, without running
anything on a developer's machine.

This guide is honest about a structural fact: **Luxora was designed to keep the
conversation local.** Moving it online is possible and this document explains
exactly how, but it is a trade, not a free upgrade. What that trade costs is
stated in §2.

---

## 1. What is already cloud-capable

The repository has had a two-role split from early on, and it works today:

```
LUXORA_ROLE=edge     conversation, models, footage, kiosk UI
LUXORA_ROLE=cloud    avatars, kiosks, studio, catalog, knowledge, analytics
LUXORA_ROLE=all      both, in one process (default)
```

**Verified in cloud role** (no keys, no models, no GPU):

| Capability | State |
|---|---|
| Platform API — kiosk config, products, campaigns, QR | Works |
| Studio API — auth, avatars, kiosks, catalog, knowledge, campaigns, team | Works |
| Analytics | Works |
| Tenant isolation, roles, tokens | Works |
| Kiosk + Studio web UI | Works — served from the same origin |
| Try-on endpoint and consent enforcement | Works; image generation needs a key |
| `/api/chat`, `/api/listen` | **Absent by design** — see §2 |
| `faster-whisper`, Ollama, numpy, Pillow | **Never imported** — image stays small |

`Dockerfile` and `fly.toml` already target this role.

## 2. The one real constraint

Conversation needs a model resident in memory. The cloud role deliberately has
none, because a GPU container idling through a showroom's quiet hours costs more
than the entire rest of the platform.

So a cloud deployment gives you **everything except speech and generation**,
unless you also swap those two modules for hosted services:

| Module | Today | To go fully online |
|---|---|---|
| `backend/llm.py` | Ollama, local | Point at a hosted chat API |
| `backend/stt.py` | faster-whisper, local | Point at a hosted transcription API |

Both are **seams** — single-file provider boundaries that have already been
swapped once each (Anthropic → Ollama; browser speech → local Whisper). The
config file already declares keys for the usual candidates. **Neither hosted
implementation is written yet.** That is implementation work, not architecture
work, and it is the honest gap in a fully cloud-first story.

### 2.1 Three deployment shapes

| Shape | Conversation | Needs a key | Reviewer needs a local machine |
|---|---|---|---|
| **A. Platform-only cloud** | No | No | No — for everything except talking |
| **B. Cloud + hosted LLM/STT** | Yes | Yes | No |
| **C. Cloud platform + local kiosk** | Yes | No | Yes, at the cabinet |

**Shape A is what to deploy for tomorrow's review** if the reviewer should not
run anything: the entire platform, studio, catalog, knowledge, tenancy and
analytics are usable from a URL. Conversation is demonstrated separately on the
machine that has a model.

**Shape C is the production design** and is what a real showroom runs.

## 3. Target architecture

```
                    ┌──────────────────────────────┐
   Reviewer  ─────► │  Fly.io (Mumbai, bom)        │
   browser          │  LUXORA_ROLE=cloud           │
                    │  Uvicorn :8080               │
                    │  ├── Platform + Studio API   │
                    │  ├── Kiosk + Studio web UI   │
                    │  └── SQLite on a volume      │
                    └──────────────┬───────────────┘
                                   │ /api/kiosk/{id}, every 5 min
                    ┌──────────────▼───────────────┐
                    │  Cabinet (Mac mini)          │
                    │  LUXORA_ROLE=edge            │
                    │  Ollama · Whisper · footage  │
                    │  Survives the network drop   │
                    └──────────────────────────────┘
```

The frontend is served **from the same origin as the API**, which is why this
guide does not need a separate static host, a CORS policy, or a build-time API
URL. That is deliberate: every one of those is a moving part that can be wrong.

## 4. Hosting

### 4.1 Backend + frontend — Fly.io

Chosen because it has an Indian region (`bom`). Singapore adds 50–100 ms to every
call, which is felt in a conversation.

**Cost:** free allowance covers a `shared-cpu-1x` / 512 MB machine that sleeps
when idle. `min_machines_running = 0` in `fly.toml` is most of why the bill is a
few dollars.

Alternatives that work identically: Render, Railway, Google Cloud Run, Azure
Container Apps. All take the same Dockerfile.

### 4.2 Building the UI into the image

`Dockerfile` currently ships the API only. To serve the web UI from the same
origin, add a build stage:

```dockerfile
FROM node:20-slim AS ui
WORKDIR /ui
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.13-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 LUXORA_ROLE=cloud
WORKDIR /app
COPY requirements-cloud.txt .
RUN pip install --no-cache-dir -r requirements-cloud.txt
COPY backend/ ./backend/
COPY knowledge/ ./knowledge/
COPY --from=ui /ui/dist ./frontend/dist
RUN mkdir -p frontend/public/avatars
EXPOSE 8080
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8080"]
```

The application serves `frontend/dist` whenever it exists, in any role.

### 4.3 Database and storage

**Today: SQLite on a Fly volume.** `fly.toml` already mounts `luxora_data`. The
catalog, knowledge passages, accounts and organisations are one file at
`knowledge/catalog.db`; avatar metadata is JSON under
`frontend/public/avatars/`.

This is genuinely adequate — a customer's catalog is a few thousand rows — but
it has two real limits:

- A volume binds the app to **one machine in one region**. No horizontal scaling.
- Backups are your responsibility (`fly ssh console` + `sqlite3 .backup`).

**When to move:** the day a second region or a second instance is needed.
`backend/store.py` and `backend/accounts.py` are the only two modules that would
change — this is stated in their docstrings and is the intended end state.

**Managed option — Supabase.** Free tier includes Postgres, auth and object
storage. `config.py` already declares `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
`SUPABASE_SERVICE_ROLE_KEY`. **Not yet implemented.** Labelled here as the
planned path, not a working one.

### 4.4 Avatar assets

Posters and clips are **not synced** — deliberately. Clips are tens of megabytes
and egress out of an Indian region bills at roughly six times the US rate.

- **Production:** footage stays on each cabinet's disk, installed by the asset
  pipeline. Only JSON crosses the wire.
- **Cloud demo:** bake the poster into the image (as above), or put media on
  object storage (Cloudflare R2 — free egress — or Supabase Storage) and set each
  avatar's `poster` to that URL.

## 5. Provider options

Every row below was checked for what it actually requires. **Nothing here is
adopted merely because it is free.**

### 5.1 LLM — required for conversation in the cloud

| Provider | Cost | Auth | Note |
|---|---|---|---|
| **Anthropic Claude** | Paid | API key | `ANTHROPIC_API_KEY` already in `config.py`. Best answer quality |
| **Groq** | Free tier, rate-limited | API key | `GROQ_API_KEY` already declared. Very fast; good for a demo |
| **NVIDIA NIM** | Free tier, 40 req/min | API key | `NVIDIA_API_KEY` already declared. **No SLA — not for a live conversation** |
| **Ollama on your own VM** | VM cost | None | Keeps the current code; needs a GPU box |

**Recommendation:** Groq for a reviewable cloud demo (fast, free tier, real
key); Claude for production quality. Both need `backend/llm.py` to gain a hosted
branch — roughly the same shape as the existing Ollama one, since both are
OpenAI-compatible or close to it.

### 5.2 Speech-to-text

| Provider | Cost | Auth | Note |
|---|---|---|---|
| **Deepgram** | Paid, free trial credit | API key | `DEEPGRAM_API_KEY` declared. ~300 ms streaming |
| **Groq Whisper** | Free tier | API key | Whisper-large via the same Groq key |
| **OpenAI Whisper API** | Paid | API key | Simple, batch only |
| **Browser Web Speech API** | Free | None | **Not viable.** Streams to a private Google endpoint whose key is compiled into Chrome; every Chromium fork fails with `network` forever. This is why local Whisper replaced it |

**Recommendation:** Groq Whisper if you already have the key for §5.1.

### 5.3 Try-on

| Provider | Cost | Auth | Env var |
|---|---|---|---|
| **Replicate** (IDM-VTON) | **Paid**, per-second | API token | `REPLICATE_API_TOKEN` |
| **fal.ai** (IDM-VTON) | **Paid**, per-request | API key | `FAL_KEY` |
| **Local** | Free | None | `TRYON_PROVIDER=local` — declared, not implemented |

**Both hosted options are paid. There is no free try-on API.** The integration is
written against both published APIs and has never run, because that needs a key.

Set one of:

```bash
TRYON_PROVIDER=replicate
REPLICATE_API_TOKEN=r8_...
# or
TRYON_PROVIDER=fal
FAL_KEY=...
```

The garment image is resolved before the call: a public `https://` URL is passed
through, and a path this server hosts is read from disk and inlined as a data
URI. So try-on works from a local install too, not only from a public host.

The visitor's photograph is inlined the same way and **never written to disk** —
not a temp file, not a cache, not the event log. This is a DPDP/GDPR requirement,
not a preference, and it is why the local provider is the preferred one.

### 5.4 On the `public-apis` catalogue

Treat it as a source of *candidates*, not of recommendations. For each entry,
check the auth requirement, whether the free tier has an SLA, and whether it
survives being on the critical path of a live conversation.

For Luxora specifically, most entries there are irrelevant — this product needs
an LLM, a transcriber, a garment-swap model and object storage, and each of those
is a considered choice rather than something to be picked from a list. **No API
has been added to this project for demonstration value.**

## 6. Environment variables

Set as Fly secrets, never in the repository:

```bash
fly secrets set LUXORA_SECRET="$(openssl rand -base64 48)"
fly secrets set TRYON_PROVIDER=replicate
fly secrets set REPLICATE_API_TOKEN=r8_...
fly secrets set GROQ_API_KEY=gsk_...
```

Non-secret values belong in `fly.toml` under `[env]`:

```toml
[env]
  LUXORA_ROLE = "cloud"
  KIOSK_ID = "cloud-demo"
```

| Variable | Required | Purpose |
|---|---|---|
| `LUXORA_ROLE` | Yes | `cloud` |
| `LUXORA_SECRET` | **Yes in cloud** | Signs studio tokens. Without it a restart invalidates every login |
| `ALLOWED_ORIGINS` | Only if split | Comma-separated exact origins |
| `TRYON_PROVIDER` | No | `local`, `replicate`, `fal` |
| `REPLICATE_API_TOKEN` / `FAL_KEY` | For try-on | **Paid** |
| `PLATFORM_URL` | On cabinets only | Where a kiosk syncs from |

## 7. Security

**Set `LUXORA_SECRET` explicitly.** Otherwise it is generated per-machine and
written to disk; on ephemeral cloud storage that means every deploy logs everyone
out.

**Create the first account immediately after deploying.** A machine with no
accounts leaves the studio open — correct for a bench, wrong on a public URL. The
first account closes it permanently and moves existing data to that organisation.

**Keys stay server-side.** No provider key ever reaches the browser. The frontend
calls this API; this API calls the provider. Do not add a key to any `VITE_`
variable — those are compiled into the bundle and are public.

**HTTPS** is handled by `force_https = true` in `fly.toml`. It is also a
functional requirement, not just hygiene: `getUserMedia` and `crypto.randomUUID`
both need a secure context.

**CORS** is off unless `ALLOWED_ORIGINS` is set. Same-origin hosting (§4.2) needs
no CORS at all — prefer that. If you must split, list exact origins; a wildcard
with credentials hands a studio session to any page that asks.

## 8. Deployment steps

```bash
# 1. Install and authenticate
curl -L https://fly.io/install.sh | sh
fly auth login

# 2. Create the app (once). fly.toml already has the settings.
fly launch --no-deploy

# 3. Create the volume for SQLite and avatar metadata
fly volumes create luxora_data --region bom --size 1

# 4. Secrets
fly secrets set LUXORA_SECRET="$(openssl rand -base64 48)"

# 5. Deploy
fly deploy

# 6. Watch it come up
fly logs
```

## 9. Verifying the deployment

```bash
APP=https://luxora-platform.fly.dev

curl $APP/api/health
# {"ok":true,"role":"cloud","avatars":N}

curl $APP/api/auth/status
# {"open":true}   ← create an account now

curl $APP/api/kiosk/cloud-demo
curl "$APP/api/products?q=shirt&avatar=krish"
```

Then in a browser:

1. `$APP/studio` — create the first account
2. Confirm the open-machine banner disappears
3. Upload a document under **Knowledge**, confirm it indexes
4. Register a cabinet under **Kiosks**
5. `$APP/` — the kiosk UI. Conversation will not respond in shape A (§2)

## 10. Connecting a cabinet

On the machine driving the panel:

```bash
LUXORA_ROLE=edge
PLATFORM_URL=https://luxora-platform.fly.dev
KIOSK_ID=mumbai-flagship-1
VITE_KIOSK_ID=mumbai-flagship-1
```

The cabinet pulls `/api/kiosk/{id}` at boot and every `SYNC_INTERVAL` seconds
(default 300), and writes the result into the folders it already reads.

**It pulls its own row and nothing else.** An earlier version fetched every
avatar on the platform, which was harmless with one customer and a cross-tenant
leak with two.

## 11. Offline behaviour

This is the part most deployments get wrong, and it is the reason for the
architecture.

- **Sync writes into the folders the app already reads.** There is no cache
  layer; the local files *are* the cache.
- A cabinet that cannot reach the platform **keeps serving its last known
  configuration** indefinitely.
- With local models (shape C), **conversation continues with the network
  unplugged**. Nothing about talking to the avatar touches the internet.
- QR codes are rendered locally by `segno`. A hosted QR service was the one
  element that went blank when the network dropped.
- In shape B, a network drop ends conversation entirely. This is the cost of
  moving the model online, and it is why production is shape C.

## 12. Recommendation

| Purpose | Shape | Why |
|---|---|---|
| **Tomorrow's review** | A | Reviewer opens a URL. Everything but conversation |
| Remote conversation demo | B | Needs a Groq key and a hosted branch in `llm.py` |
| **Production showroom** | C | Conversation survives the network. The design intent |
