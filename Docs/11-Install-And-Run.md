# Installation and Run Guide

From a clean machine to a running Luxora kiosk.

Written against the actual repository. Every command below is one that exists in
this project — nothing here is illustrative.

---

## 1. What you are installing

Luxora runs as **one or two processes**, depending on how you start it:

| Mode | Processes | URL | Use |
|---|---|---|---|
| Development | API on `:8000`, Vite on `:5173` | http://localhost:5173 | Editing code |
| Kiosk | One process on `:8000` | http://localhost:8000 | What a cabinet runs |

In kiosk mode the backend serves the built frontend itself, so there is no second
server and no CORS.

## 2. Prerequisites

| Tool | Version | Why |
|---|---|---|
| **Python** | 3.11+ | Backend. 3.13 is what this was verified on |
| **Node.js** | 20+ | Frontend build |
| **Git** | any | Getting the repository |
| **ffmpeg** | any | Audio decoding for speech recognition |
| **Ollama** | latest | The local language model |

### Windows

```powershell
winget install Python.Python.3.13
winget install OpenJS.NodeJS
winget install Git.Git
winget install Gyan.FFmpeg
winget install Ollama.Ollama
```

### macOS

```bash
brew install python node git ffmpeg ollama
```

See `Docs/12-Mac-Setup.md` for the full Mac path, including Apple Silicon notes.

### Linux

```bash
sudo apt install python3 python3-venv nodejs npm git ffmpeg
curl -fsSL https://ollama.com/install.sh | sh
```

Close and reopen your terminal after installing, so the new commands are on
`PATH`.

## 3. Get the repository

```bash
git clone <your-repository-url> luxora
cd luxora
```

## 4. Automatic setup — macOS and Linux

```bash
./setup.sh
```

`setup.sh` is safe to re-run. It checks prerequisites, **sizes the model to the
machine**, creates the virtualenv, installs both dependency sets, pulls the
model, builds the frontend, and writes a `run.sh` with the chosen model baked in.

Model selection is by unified memory:

| Memory | Model |
|---|---|
| 32 GB or more | `qwen2.5:14b` |
| 16 GB or more | `llama3.1:8b` |
| Less | `llama3.2:3b` |

Override before running:

```bash
OLLAMA_MODEL=qwen2.5:14b ./setup.sh
```

> `run.sh` does not exist until `setup.sh` has been run. If you are following the
> manual path below, start Uvicorn directly instead.

## 5. Manual setup — Windows, or any machine

### 5.1 Python environment

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

On macOS/Linux the interpreter is `./.venv/bin/python` throughout.

`requirements.txt` is the **edge** role — it includes `faster-whisper`, which
pulls in a few hundred megabytes of model runtime. For a cloud deployment that
runs no models, use `requirements-cloud.txt` instead.

### 5.2 Frontend

```powershell
cd frontend
npm install
npm run build
cd ..
```

`npm run build` writes `frontend/dist/`, which the backend serves in kiosk mode.

> **Assets are copied at build time.** `frontend/public/` is copied into
> `frontend/dist/` by Vite. If you replace an avatar poster, a clip or a campaign
> image, you must run `npm run build` again or the running kiosk will keep
> serving the old file.

### 5.3 Model

```bash
ollama pull llama3.2:3b     # or the model you intend to use
ollama serve                 # usually already running as a service
```

Verify:

```bash
curl http://localhost:11434/api/tags
```

## 6. Environment variables

```bash
cp .env.example .env
```

**Nothing in `.env` is required.** The platform runs entirely on local models and
files with every value blank. Each key swaps one component from local to hosted.

The values worth knowing about:

| Variable | Default | Meaning |
|---|---|---|
| `LUXORA_ROLE` | `all` | `edge`, `cloud` or `all` |
| `KIOSK_ID` | `default` | Which cabinet this machine is |
| `VITE_KIOSK_ID` | `default` | The same id, for the frontend. Keep them in step |
| `OLLAMA_MODEL` | `llama3.2:3b` | The conversation model |
| `WHISPER_MODEL` | `base.en` | Speech recognition model size |
| `LUXORA_SECRET` | generated | Signs studio session tokens |
| `PLATFORM_URL` | blank | Set only if this kiosk mirrors a central platform |
| `TRYON_PROVIDER` | `local` | `local`, `replicate` or `fal` |

`LUXORA_SECRET` is generated on first use and written to `knowledge/.secret`,
which is gitignored. Set it explicitly only when several machines must accept
each other's tokens.

Startup prints which services are wired, so a missing key is visible immediately
rather than as a confusing failure mid-conversation.

## 7. Database initialisation

**There is no initialisation step.** The catalog, knowledge passages and accounts
live in a single SQLite file at `knowledge/catalog.db`, created automatically on
first use, and migrated forward automatically if it predates a schema change.

To load the sample catalog:

```bash
./.venv/Scripts/python.exe -m backend.ingest knowledge/products.csv
./.venv/Scripts/python.exe -m backend.ingest knowledge/apparel.csv
```

`ingest` accepts CSV, JSON, TXT, Markdown, DOCX and PDF, and decides what to do
with each by shape — rows and headers become products, prose becomes searchable
document passages.

## 8. Running

### 8.1 Kiosk mode — one process, what a cabinet runs

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --port 8000
```

Open **http://localhost:8000**

macOS/Linux, after `setup.sh`:

```bash
./run.sh kiosk
```

### 8.2 Development mode — two processes

Terminal 1:

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --reload --port 8000
```

Terminal 2:

```powershell
cd frontend
npm run dev
```

Open **http://localhost:5173** — Vite proxies `/api` to port 8000.

macOS/Linux: `./run.sh`

### 8.3 Cloud role — no models

```bash
LUXORA_ROLE=cloud python -m uvicorn backend.main:app --port 8000
```

Serves the platform and studio APIs; the conversation routes are absent.

## 9. URLs

| URL | What |
|---|---|
| http://localhost:8000 | Kiosk (kiosk mode) |
| http://localhost:5173 | Kiosk (development mode) |
| http://localhost:8000/studio | Avatar Studio |
| http://localhost:8000/docs | Interactive API documentation |
| http://localhost:8000/api/health | Health check |

**Use `localhost`, not a LAN IP.** Browsers only grant microphone access to a
secure context. `http://localhost` qualifies; `http://192.168.x.x` does not.

## 10. First run

1. Open http://localhost:8000
2. Press **`** (backtick) to open the diagnostic transcript panel, **bottom-left**
3. Click the blue microphone button on the right edge and allow the permission
4. Watch the `level` number — it should rise above `0.02` when you speak
5. Say *"show me shirts"*
6. Then *"tell me about the linen shirt"* to open the detail view with its QR code

The Studio at `/studio` is open until the first account is created. Creating one
closes it permanently and moves whatever already exists on disk to that
organisation.

## 11. Tests

```bash
cd frontend && npm test                          # 50
./.venv/Scripts/python.exe -m backend.test_catalog    # 27
./.venv/Scripts/python.exe -m backend.test_platform   # 98
./.venv/Scripts/python.exe -m backend.test_api        # 52
```

**227 checks total.**

> Do not run the backend suites through `python -m unittest`. They are
> assert-based scripts, not `TestCase` classes, and unittest reports zero tests.

## 12. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Cannot reach Ollama` | Ollama not running | `ollama serve`, then `curl localhost:11434/api/tags` |
| Microphone button does nothing | Not a secure context | Use `localhost`, not a LAN IP |
| `level` stays at `0.000` | No audio reaching the app | Check OS input device; look for an amber line in the transcript |
| `level` moves but never reaches `0.02` | Mic quieter than the threshold | Lower `voiceThreshold` in `frontend/src/voice/voice.config.ts` |
| He answers your half-sentence | End-of-turn silence too short | Raise `endOfTurnSilence` above 700 ms |
| Your own words struck through as `echo` | Echo filter too aggressive | Lower speaker volume; see the `ponytail:` note in `frontend/src/logic.ts` |
| Avatar cropped to a slice of leg | Landscape window, 9:16 asset | Already fixed via `fit: 'contain'`; resize to portrait for true framing |
| Grey rectangle around the avatar | Poster background not pure white | Re-run `make_poster.py`; it now warns |
| Changed an asset, nothing happened | `dist/` is stale | `cd frontend && npm run build` |
| Unicode crash in a script | Windows console is cp1252 | `sys.stdout.reconfigure(encoding="utf-8")` |
| Studio says "no accounts" | No account created yet | Expected on a fresh install; create one from the banner |
| `unittest` reports zero tests | Wrong runner | Use `python -m backend.test_*` |
| Port 8000 in use | Another instance | `--port 8001`, or stop the other one |

## 13. Stopping

Press **Ctrl-C** in each terminal.

To confirm nothing is left listening:

```powershell
netstat -ano | findstr :8000        # Windows
lsof -i :8000                        # macOS / Linux
```

Ollama runs as a background service and is left running deliberately — stopping
it means a fifteen-second model reload on the next conversation.
