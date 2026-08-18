# The cloud role only. It serves avatars, kiosks and the studio API — no models,
# no GPU, no footage. Installing faster-whisper here would add gigabytes and buy
# nothing: the conversation runs on the machine that drives the panel.
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

# Avatar metadata lives here. Media does not — clips stay on each kiosk's disk,
# where they cost nothing to serve.
RUN mkdir -p frontend/public/avatars

EXPOSE 8080
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8080"]
