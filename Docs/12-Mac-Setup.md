# Mac Setup Guide

Moving Luxora to a Mac and running it there.

The Mac is not a second-class target for this project — it is **the intended
production hardware**. A Mac mini M4 Pro with 48 GB drives the 52" transparent
OLED panel at 2160×3840, runs the models, and serves the kiosk to itself on
`localhost`.

Steps that apply only to Apple Silicon are marked **[Apple Silicon]**.

---

## 1. Which Mac

| | Apple Silicon (M1–M4) | Intel Mac |
|---|---|---|
| Runs the app | Yes | Yes |
| Local LLM | Fast, GPU-accelerated | Slow, CPU only |
| Whisper | Fast | Usable |
| Recommended model | Sized to memory, see §6 | `llama3.2:3b` only |
| Production target | **Yes** | No |

An Intel Mac is fine for reviewing the interface. It is not suitable for judging
conversation latency.

## 2. Getting the project onto the Mac

### Option A — Git (preferred)

```bash
git clone <your-repository-url> luxora
cd luxora
```

### Option B — Copy from the Windows machine

Copy the folder, then **delete these before or after transfer**:

```bash
rm -rf .venv frontend/node_modules frontend/dist
```

> **Never copy `.venv` or `node_modules` between machines.** Both contain
> compiled, platform-specific binaries. A Windows `.venv` on a Mac fails in ways
> that look like application bugs. Copy the source; rebuild the rest.

Keep `knowledge/catalog.db` if you want the catalog, accounts and documents to
come across. Do **not** copy `.env` if it holds machine-specific paths, and note
that `knowledge/.secret` signs studio tokens — copy it only if you want existing
logins to remain valid.

## 3. Prerequisites

Install Homebrew if it is not present:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

**[Apple Silicon]** Homebrew installs to `/opt/homebrew`, not `/usr/local`. If
`brew` is not found after installing:

```bash
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"
```

Then:

```bash
brew install python node git ffmpeg ollama
```

Verify:

```bash
python3 --version     # 3.11 or newer
node --version        # 20 or newer
ffmpeg -version
ollama --version
```

**[Apple Silicon]** Confirm you are not running everything through Rosetta:

```bash
uname -m        # expect: arm64
```

If this prints `x86_64` on an Apple Silicon Mac, your terminal is running under
Rosetta. Everything will work but the model will be several times slower. Turn it
off: Finder → Applications → right-click Terminal → Get Info → uncheck *Open
using Rosetta*.

## 4. One-command setup

```bash
cd luxora
./setup.sh
```

If it will not execute:

```bash
chmod +x setup.sh
./setup.sh
```

`setup.sh` checks prerequisites, sizes the model to the machine's memory,
creates `.venv`, installs Python and npm dependencies, pulls the model, builds
the frontend, and writes `run.sh`.

It is safe to re-run.

## 5. Manual setup, if you prefer

```bash
python3 -m venv .venv
./.venv/bin/python -m pip install --upgrade pip
./.venv/bin/python -m pip install -r requirements.txt

cd frontend && npm install && npm run build && cd ..
```

**[Apple Silicon]** `faster-whisper` and its `ctranslate2` backend ship arm64
wheels — no compilation and no Rosetta required. If pip tries to build from
source, your Python is an x86 build; reinstall with `brew install python`.

## 6. Model selection

`setup.sh` picks by unified memory:

| Unified memory | Model | Note |
|---|---|---|
| 32 GB+ | `qwen2.5:14b` | The Mac mini M4 Pro target |
| 16 GB+ | `llama3.1:8b` | Good balance |
| Less | `llama3.2:3b` | The Windows-era fallback |

Override:

```bash
OLLAMA_MODEL=qwen2.5:14b ./setup.sh
```

**This matters more than any other setting on a Mac.** `llama3.2:3b` exists in
this project only because the first development machine had 4 GB of VRAM. On a
Mac with real memory it is the wrong choice — it is the model that fabricated
prices and invented product lines.

Prompt fixes have since corrected the documented cases on 3B (see
`Docs/10-Test-Report.md` §8.2), but a larger model is still the right answer on
this hardware.

Pull it and confirm:

```bash
ollama pull qwen2.5:14b
ollama list
curl http://localhost:11434/api/tags
```

## 7. Environment

```bash
cp .env.example .env
```

Nothing is required. Worth setting on a Mac:

```bash
OLLAMA_MODEL=qwen2.5:14b
WHISPER_MODEL=base.en      # or small.en if you have the headroom
KIOSK_ID=default
VITE_KIOSK_ID=default
```

## 8. Running

### Kiosk — what the cabinet runs

```bash
./run.sh kiosk
```

Or directly:

```bash
./.venv/bin/python -m uvicorn backend.main:app --port 8000
```

Open **http://localhost:8000**

### Development — two processes

```bash
./run.sh
```

Open **http://localhost:5173**

## 9. Microphone and browser permissions

This is the step most likely to cost time on a Mac.

### 9.1 macOS must allow the browser to use the microphone

**System Settings → Privacy & Security → Microphone** → enable your browser.

macOS asks once, the first time. If it was ever denied, the browser will never
prompt again and the app will simply never hear anything — with no error. Check
this setting before debugging anything else.

### 9.2 The browser must be on a secure context

Use **http://localhost:8000**. Not `127.0.0.1` (works, but be consistent), and
**not** a LAN address like `http://192.168.1.40:8000` — browsers refuse
microphone access to plain-HTTP non-localhost origins.

This is precisely why the cabinet drives its own panel: the app stays on
`localhost` and needs no HTTPS and no Chrome flags.

If you must serve a LAN address, add that exact origin to
`chrome://flags/#unsafely-treat-insecure-origin-as-secure` and relaunch.

### 9.3 Chrome, not a Chromium fork

Use Chrome or Edge. Brave, Arc, Opera and Vivaldi are supported for the
interface, and the app's local Whisper path does not depend on Google's speech
service — but Chrome is what this has been driven in.

### 9.4 Driving the panel

Connect the transparent OLED over HDMI as a second display and move the browser
window to it, then press **⌃⌘F** for fullscreen. The app stays on `localhost`,
which sidesteps the permission problem entirely.

## 10. Verifying the install

```bash
cd frontend && npm test && cd ..
./.venv/bin/python -m backend.test_catalog
./.venv/bin/python -m backend.test_platform
./.venv/bin/python -m backend.test_api
```

Expect **50 / 27 / 98 / 52 = 227 passing, 0 failures**.

Then, in the app:

1. Open http://localhost:8000
2. Press **`** for the transcript panel (bottom-left)
3. Tap the blue microphone, allow the permission
4. Speak — the `level` number must rise above `0.02`
5. Say *"show me shirts"*, then *"tell me about the linen shirt"*

## 11. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `brew: command not found` | **[Apple Silicon]** Homebrew not on PATH | `eval "$(/opt/homebrew/bin/brew shellenv)"` |
| `uname -m` prints `x86_64` | Terminal under Rosetta | Uncheck *Open using Rosetta* in Get Info |
| pip compiles from source | x86 Python on Apple Silicon | `brew install python`, recreate `.venv` |
| `./setup.sh: Permission denied` | Not executable | `chmod +x setup.sh` |
| No microphone prompt ever appears | Denied once in macOS | System Settings → Privacy & Security → Microphone |
| Microphone works elsewhere, not here | Not a secure context | Use `localhost` |
| Replies take many seconds | Model too large, or Rosetta | Check `uname -m`; try a smaller model |
| `ollama: connection refused` | Service not running | `ollama serve` |
| Fans audible, replies slowing | Sustained thermal load | Expected on a small chassis; measure at hour three |
| Everything imports but nothing runs | Copied `.venv` from Windows | `rm -rf .venv` and rebuild |
| Changed an asset, no change on screen | `dist/` is stale | `cd frontend && npm run build` |

## 12. Known Apple Silicon limitation

**Local lip-sync is unproven on this hardware.** MuseTalk has no official macOS
support; MLX audio-to-video is the better bet but less travelled. The renderer
seam exists on both sides and currently has one implementation (MP4 crossfade)
behind it.

This is deliberate. Building a renderer that switches between MP4 and something
nobody has written is a factory for one product. The spike that settles it has
not been run.
