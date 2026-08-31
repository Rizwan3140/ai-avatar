#!/usr/bin/env bash
# Assemble everything a Luxora.app needs into `app/Resources/`.
#
#     ./build-app.sh
#
# Run on the Mac that will build the bundle. Re-runnable: each step skips work
# already done, so a failed download costs one step rather than the whole 4.8GB.
#
# This produces the *payload*, not the .app — Tauri packages what lands here.
# Splitting them means the slow part (Python, two models) is done once and
# cached, while the shell is rebuilt in seconds during development.
#
# Why a portable Python rather than the system one: a bundle has to run on a
# machine that has never had Python installed, from inside /Applications, with
# no virtualenv and no PATH. `python-build-standalone` is a relocatable CPython
# built for exactly that — it is what `uv` ships inside itself.

set -euo pipefail
cd "$(dirname "$0")"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

OUT="app/Resources"
PY_VERSION="3.12.8"
PY_RELEASE="20241219"
# Apple Silicon only. An Intel cabinet would need the x86_64 tarball and a
# different local model — MLX does not exist there.
PY_TRIPLE="aarch64-apple-darwin"

LLM_MODEL="${MLX_MODEL:-mlx-community/Qwen2.5-7B-Instruct-4bit}"
STT_MODEL="${WHISPER_MODEL:-base.en}"

if [ "$(uname)" != "Darwin" ] || [ "$(uname -m)" != "arm64" ]; then
  echo "This assembles a macOS Apple Silicon bundle and must run on one."
  echo "Everything it does is downloads and file copies; nothing is compiled here."
  exit 1
fi

mkdir -p "$OUT"

# --- a Python that runs from anywhere ----------------------------------------
if [ ! -x "$OUT/python/bin/python3" ]; then
  say "Portable Python $PY_VERSION"
  url="https://github.com/astral-sh/python-build-standalone/releases/download/$PY_RELEASE/cpython-$PY_VERSION+$PY_RELEASE-$PY_TRIPLE-install_only.tar.gz"
  curl -fsSL "$url" -o /tmp/luxora-python.tar.gz
  rm -rf "$OUT/python"
  mkdir -p "$OUT/python"
  # The tarball contains a top-level `python/`, so strip it.
  tar -xzf /tmp/luxora-python.tar.gz -C "$OUT"
  rm /tmp/luxora-python.tar.gz
  echo "  $("$OUT/python/bin/python3" --version)"
else
  echo "  python already unpacked"
fi

PY="$OUT/python/bin/python3"

# --- the packages, into that Python, not a virtualenv ------------------------
# A virtualenv records absolute paths to the interpreter that made it, so one
# built here would break the moment the bundle moved to /Applications. Installed
# straight into the portable tree, everything stays relative.
say "Dependencies"
"$PY" -m pip install --quiet --upgrade pip
"$PY" -m pip install --quiet -r requirements.txt
"$PY" -m pip install --quiet mlx-lm
echo "  installed"

# --- our own code -------------------------------------------------------------
say "Application"
rm -rf "$OUT/backend"
# Source only. __pycache__ is this machine's, and knowledge/ is a customer's.
rsync -a --exclude='__pycache__' --exclude='*.pyc' backend/ "$OUT/backend/"

if [ ! -d frontend/dist ]; then
  (cd frontend && npm install --silent && npm run build)
fi
rm -rf "$OUT/dist"
rsync -a frontend/dist/ "$OUT/dist/"
echo "  backend and interface copied"

# --- models, fetched now so a cabinet never fetches them ----------------------
# faster-whisper downloads from HuggingFace the first time something speaks. On
# a showroom floor that is a 141MB download in the middle of a visitor's first
# sentence, and it fails entirely with no network. HF_HOME points here at
# runtime so both models are simply found.
say "Speech model ($STT_MODEL)"
HF_HOME="$OUT/models" "$PY" - <<PY
from faster_whisper import WhisperModel
WhisperModel("$STT_MODEL", device="cpu", compute_type="int8")
print("  ready")
PY

say "Language model ($LLM_MODEL — this is the slow part, ~4.3GB)"
HF_HOME="$OUT/models" "$PY" - <<PY
from huggingface_hub import snapshot_download
snapshot_download("$LLM_MODEL")
print("  ready")
PY

# --- what the bundle will run -------------------------------------------------
# Tauri spawns this. It exists so the Rust side needs to know one path and no
# Python, and so the same command can be run by hand when something is wrong.
cat > "$OUT/start" <<'LAUNCH'
#!/bin/bash
# Started by Luxora.app. Everything is resolved relative to this file, because
# /Applications is not where it was built and the bundle may be anywhere.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

# The models live inside the bundle; nothing is ever downloaded at runtime.
export HF_HOME="$HERE/models"
export HF_HUB_OFFLINE=1

# A customer's things go where a customer's things go. The bundle is read-only
# and signed — writing into it breaks the signature.
export LUXORA_DATA="$HOME/Library/Application Support/Luxora"
mkdir -p "$LUXORA_DATA"

export LUXORA_ROLE="${LUXORA_ROLE:-edge}"
export PYTHONPATH="$HERE"
export PYTHONDONTWRITEBYTECODE=1   # the bundle is read-only; do not try

# Port 0 lets the OS pick a free one and uvicorn prints which. 8000 is a
# developer's habit and something on a customer's machine will own it one day.
exec "$HERE/python/bin/python3" -m uvicorn backend.main:app \
  --host 127.0.0.1 --port "${LUXORA_PORT:-0}"
LAUNCH
chmod +x "$OUT/start"

say "Done"
du -sh "$OUT" 2>/dev/null | sed 's/^/  /'
echo "  payload is ready at $OUT"
echo
echo "Next, on this Mac:"
echo "  point tauri.conf.json's bundle.resources at app/Resources/"
echo "  npm create tauri-app  →  then  npm run tauri build"
