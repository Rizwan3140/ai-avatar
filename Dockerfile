# The cloud role — platform API, Studio, kiosk UI, and conversation when a
# hosted model is configured.
#
# Portable on purpose. It listens on $PORT so the same image runs unchanged on
# Fly (8080), Hugging Face Spaces (7860), Render ($PORT) or a VPS behind a proxy,
# and it runs as an unprivileged uid 1000 because Spaces requires that and
# nothing else objects to it.
#
# No local models. faster-whisper is deliberately absent — a few hundred
# megabytes of runtime this container would never execute, which is why stt.py
# imports it inside the function that needs it rather than at module scope.

# --- the interface -----------------------------------------------------------
# Built here rather than committed, so a deploy cannot serve a stale bundle.
FROM node:20-slim AS ui
WORKDIR /ui
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# --- the server --------------------------------------------------------------
FROM python:3.13-slim

# uid 1000 with a home. Hugging Face Spaces runs containers as this user and
# writes fail without it; everywhere else it is simply good practice.
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    LUXORA_ROLE=cloud \
    PORT=8080

WORKDIR $HOME/app

# requirements-cloud.txt is deliberately a different, much shorter list.
COPY --chown=user requirements-cloud.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements-cloud.txt

COPY --chown=user backend/ ./backend/

# No `knowledge/` copy. It held sample CSVs that no longer ship and, through the
# build context, this machine's event log. The directory is created empty and
# filled at runtime — by the volume in a deployment, by the customer everywhere
# else.
RUN mkdir -p knowledge

# The built interface. main.py serves frontend/dist whenever it exists, in any
# role, so this is what turns a JSON API into something a reviewer can click.
COPY --chown=user --from=ui /ui/dist ./frontend/dist

# Avatar metadata and uploaded campaign media land here. Footage does not —
# clips are tens of megabytes and a cabinet serves its own from local disk.
RUN mkdir -p frontend/public/avatars

EXPOSE 8080

# Shell form, so $PORT expands at runtime rather than being taken literally —
# and `exec`, so uvicorn replaces the shell instead of running as its child.
#
# Without it the shell is PID 1, `docker stop` sends SIGTERM to the shell, the
# shell does not pass it on, and every redeploy waits out the ten-second grace
# period and then SIGKILLs a process holding SQLite open. The build warns about
# the shell form for exactly this; `exec` is the answer that keeps $PORT.
CMD exec uvicorn backend.main:app --host 0.0.0.0 --port ${PORT}
