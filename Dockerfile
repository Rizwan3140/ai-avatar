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
COPY --chown=user knowledge/ ./knowledge/

# The built interface. main.py serves frontend/dist whenever it exists, in any
# role, so this is what turns a JSON API into something a reviewer can click.
COPY --chown=user --from=ui /ui/dist ./frontend/dist

# Avatar metadata and uploaded campaign media land here. Footage does not —
# clips are tens of megabytes and a cabinet serves its own from local disk.
RUN mkdir -p frontend/public/avatars

EXPOSE 8080

# Shell form, so $PORT expands at runtime rather than being taken literally.
CMD uvicorn backend.main:app --host 0.0.0.0 --port ${PORT}
