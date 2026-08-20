# The cloud role. Serves the platform API, the Studio and the kiosk UI.
#
# No local models: with GROQ_API_KEY set, `llm.py` and `stt.py` resolve to their
# hosted branches and conversation works from a URL. Without it the image still
# runs — it simply serves everything except talking, and says so at startup.
#
# faster-whisper is deliberately absent. It is a few hundred megabytes of model
# runtime that this container would never execute, which is why `stt.py` imports
# it inside the function that needs it rather than at module scope.

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

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    LUXORA_ROLE=cloud

WORKDIR /app

# requirements-cloud.txt is deliberately a different, much shorter list.
COPY requirements-cloud.txt .
RUN pip install --no-cache-dir -r requirements-cloud.txt

COPY backend/ ./backend/
COPY knowledge/ ./knowledge/

# The built interface. `main.py` serves this whenever it exists, in any role.
COPY --from=ui /ui/dist ./frontend/dist

# Avatar metadata and campaign media live here, on the mounted volume. Clips do
# not — footage stays on each cabinet's own disk, where serving it costs nothing
# and never appears on an egress bill.
RUN mkdir -p frontend/public/avatars

EXPOSE 8080
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8080"]
