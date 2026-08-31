# Building Luxora into a Mac application

From a Mac that has never seen this project, to a `Luxora.app` a customer can
double-click.

Everything here runs on the Mac. Nothing in this guide can be done on Windows —
a macOS bundle must be compiled and signed on macOS.

---

## 0. What you are building

```
Luxora.app/Contents/
  MacOS/luxora            the Tauri binary — window, updater, starts the API
  Resources/
    start                 the launcher script
    python/               relocatable CPython + our dependencies    ~350 MB
    backend/  dist/       our code and the built interface
    models/               Whisper 141 MB + Qwen2.5-7B 4-bit 4.3 GB
```

About **4.8 GB**. The model is most of it and is why the cabinet keeps talking
when the network drops.

The customer's own things — catalog, avatars, uploads, logs — go to
`~/Library/Application Support/Luxora`, never inside the bundle. A signed `.app`
is read-only, and writing into it breaks the signature.

---

## 1. Prerequisites

Two, and one is temporary.

```bash
xcode-select --install                                  # git, and the compiler Rust needs
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install python@3.12 node
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh   # Tauri is Rust
```

**Node is only needed here, on the build machine.** It builds the interface; the
customer's Mac never runs JavaScript tooling. Same for Rust.

You do **not** need ffmpeg or Ollama. PyAV carries its own ffmpeg — 48 binaries,
libav 18 — and the local model is MLX by pip, which needs no system service and
no administrator.

---

## 2. Get it running before you package it

Packaging something that has never worked is how you spend a day debugging Tauri
for a Python bug.

```bash
git clone https://github.com/Rizwan3140/ai-avatar.git luxora
cd luxora
./setup.sh
```

`setup.sh` makes a virtualenv, installs the dependencies, builds the interface,
installs `mlx-lm` and pulls the local model. On Apple Silicon that model is
Qwen2.5-7B — no Ollama, no administrator prompt.

Then give it your Groq key, so hosted answers come first and every cabinet
sounds the same:

```bash
echo 'GROQ_API_KEY=gsk_your_key' >> .env      # a shell that writes UTF-8
./run.sh kiosk
```

Open **http://localhost:8000**. A fresh install has no avatars, so it redirects
to `/studio` — create one there, upload footage, import a catalog.

**Check these four before going further**, because each is far cheaper to find
now than inside a bundle:

1. It answers a question, and the price it says matches the catalog.
2. Pull the network mid-conversation. It keeps answering, from the local model.
3. The microphone works. `localhost` is a secure context, so no HTTPS is needed.
4. **Talk to it for two minutes and watch `knowledge/events/`.** Any `question`
   event arriving a few seconds after *it* speaks, containing its own words, is
   the echo loop. It was fixed against a log, never against a real microphone —
   this is the first time anyone will know.

---

## 3. Assemble the payload

```bash
./build-app.sh
```

Downloads a relocatable CPython, installs the dependencies into it, copies the
backend and the built interface, and fetches both models. Roughly 4.8 GB and
slow the first time. Re-runnable — each step skips work already done, so a failed
download costs one step and not the whole thing.

It refuses to run on anything but Apple Silicon, and does no compiling; it is
downloads and file copies.

Check it landed:

```bash
du -sh app/Resources        # ~4.8G
app/Resources/start         # should start the API and print a port
```

---

## 4. Wrap it in a window

```bash
npm create tauri-app@latest       # name: luxora, frontend: none
```

Then in `src-tauri/tauri.conf.json`:

```json
{
  "productName": "Luxora",
  "identifier": "com.yourcompany.luxora",
  "bundle": {
    "active": true,
    "targets": ["dmg", "app"],
    "resources": ["../app/Resources/"],
    "macOS": {
      "minimumSystemVersion": "13.0"
    }
  }
}
```

`resources` takes whole directories and keeps their structure. Sidecars are
single binaries only and could never carry a Python tree — this is the mechanism
that makes the whole approach work.

In `src-tauri/Info.plist`, two keys. Without them macOS refuses the microphone
**silently** and the cabinet is deaf with no error on screen:

```xml
<key>NSMicrophoneUsageDescription</key>
<string>Luxora listens so visitors can talk to the showroom.</string>
<key>NSCameraUsageDescription</key>
<string>Luxora takes one photograph when a visitor asks to try something on.</string>
```

The Rust side does three things:

1. Resolve `Resources/start` through Tauri's path resolver and spawn it.
2. Read the port uvicorn prints, poll `/api/health`, **then** show the window.
   A cabinet displaying a connection error for four seconds while Python starts
   looks broken on the one screen that must not.
3. Kill the child on quit, including force-quit. An orphaned uvicorn holding the
   port makes the next launch fail for a reason nobody can see.

Build it:

```bash
npm run tauri build
```

---

## 5. Signing

An unsigned app **runs fine when copied from a USB stick** — the quarantine flag
is set by whatever downloads a file, and a copy sets nothing. That is enough for
the first install.

It stops being enough the moment the app updates itself, because a bundle the
updater *downloads* is quarantined even if the original was not.

So: install the first one from a stick, and buy the Apple Developer account
($99/yr) before the second release.

When you do, **sign a hello-world build first**. Every embedded binary needs
signing individually, `--deep` has been deprecated for years, and diagnosing
that at 4.8 GB with a Python tree inside is genuinely unpleasant.

```bash
codesign -vvv --strict Luxora.app     # must pass
spctl -a -vvv Luxora.app              # must say "accepted"
```

---

## 6. Installing it on the cabinet

1. Copy `Luxora.dmg` across — a USB stick avoids Gatekeeper entirely.
2. Drag to Applications, open it. First launch shows the placeholder silhouette
   and goes to the Studio.
3. Create the avatar, upload the four clips, import the catalog.
4. **System Settings → Energy → start up automatically after a power failure.**
   Needs an administrator once. Without it a power cut leaves a dark cabinet
   until somebody visits it.
5. **System Settings → General → Login Items → add Luxora.** So a reboot ends
   with the panel running rather than at a desktop.
6. Turn off display sleep and the screensaver, or the OS will blank the panel
   whatever the app decides.

---

## 7. Optional: the cloud Studio

Only if you want to manage cabinets remotely, or run more than one. A single
cabinet is complete on its own — it has a Studio at `/studio` and needs no
server.

If you do want it, `deploy/compose.yml` is ready: a $6/month droplet in
Bangalore, a domain whose A record resolves *before* the first `compose up`, and
then set `PLATFORM_URL` and `KIOSK_ID` on the cabinet. See
`Docs/13-Cloud-Run.md`.

---

## When something goes wrong

**The window is blank.** The API did not start. Run `app/Resources/start` by
hand and read the error — that is exactly why it is a separate script.

**"Cannot be opened because Apple cannot check it."** It was downloaded rather
than copied. System Settings → Privacy & Security → Open Anyway, or copy it from
a stick instead.

**It cannot hear.** Check the two `Info.plist` keys, then System Settings →
Privacy & Security → Microphone. macOS denies this silently.

**It answers itself.** The echo loop. Lower `WHISPER_NO_SPEECH` in `.env`
(default 0.6) and check the microphone is not picking up the speaker directly.

**Prices are wrong, or it invents products.** It is running on the local model
rather than Groq. Check the key in `.env` and look for `provider_fallback` in
`knowledge/events/`.

**It forgot everything after an update.** Data should be in
`~/Library/Application Support/Luxora`. If it is inside the bundle, `LUXORA_DATA`
is not being set by the launcher.
