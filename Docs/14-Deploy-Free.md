# Deploying without a card

Fly.io asks for a payment method at signup. This is the path that does not, plus
what to buy if this goes beyond a demo.

**Recommendation: deploy to Hugging Face Spaces for a review, and buy nothing.**
A VPS bought hours before a demo adds risk, not safety.

---

## 1. Hugging Face Spaces — free, no card

A Space is a git repository with a `Dockerfile` and a `README.md` carrying a YAML
block. Push it and you get a public HTTPS URL.

HTTPS matters here beyond hygiene: **`getUserMedia` needs a secure context**, so
without it the reviewer's microphone will not work at all.

### 1.1 What it gives you, and what it does not

| | |
|---|---|
| Cost | Free, no card |
| URL | `https://<user>-<space>.hf.space`, HTTPS |
| Container | Your `Dockerfile`, runs as uid 1000, listens on `7860` |
| Secrets | Space **Settings → Variables and secrets**, injected at runtime |
| **Storage** | **Ephemeral.** "Data written on disk is lost whenever your Space restarts." |
| Sleep | Idle Spaces pause; the next visit wakes them |

**The storage limit is the one to understand.** On restart the Space loses
`catalog.db` — accounts, uploaded products, uploaded documents, campaign media
and any avatar created through the Studio.

It does *not* come back empty: `ingest.seed_if_empty()` runs at startup and loads
`knowledge/products.csv` and `apparel.csv`, so a restarted Space still has twelve
products and a working demo. Anything uploaded *after* deploy is what goes.

That is fine for a review. It is not fine for a customer, which is what §2 is for.

### 1.2 Deploy

1. Create a Space at **huggingface.co/new-space** — SDK **Docker**, visibility
   **Public** or **Private**.

2. Clone it and copy this project in:

   ```bash
   git clone https://huggingface.co/spaces/<user>/<space> luxora-space
   cd luxora-space
   # copy everything except .git from the project
   ```

3. Add a `README.md` **at the root of the Space repo** with this block at the
   very top. Spaces reads it as configuration; it is not the project README.

   ```markdown
   ---
   title: Luxora
   emoji: 🧍
   colorFrom: gray
   colorTo: blue
   sdk: docker
   app_port: 7860
   ---

   AI digital human for transparent OLED showroom cabinets.
   ```

4. In **Settings → Variables and secrets**, add:

   | Name | Kind | Value |
   |---|---|---|
   | `PORT` | Variable | `7860` |
   | `LUXORA_SECRET` | **Secret** | any long random string |
   | `GROQ_API_KEY` | **Secret** | `gsk_…` from console.groq.com |

   `LUXORA_ROLE=cloud` is already set in the Dockerfile.

5. `git push`. The build runs on their machines; watch it in the **Logs** tab.

### 1.3 The two keys

- **`GROQ_API_KEY`** — free, no card, from **console.groq.com**. Without it the
  Space serves everything *except* conversation: `/api/chat` is not registered
  and the startup banner says which implementation is answering.
- **`LUXORA_SECRET`** — signs Studio sessions. Without it a value is generated
  per-container onto ephemeral storage, so **every restart logs everyone out**.

### 1.4 First thing after it comes up

Open `/studio` and **create the first account**. A machine with no accounts leaves
the Studio open, which is correct on a bench and wrong on a public URL.

---

## 2. If it goes past a demo: a small VPS

Hostinger, Hetzner, DigitalOcean — any of them. What a VPS buys over a free tier
is the thing free tiers cannot give: **a disk that survives a restart.**

### 2.1 Buy the cheapest tier

**Do not size it for the model.** A VPS has no GPU, and an 8B model on shared CPU
produces a handful of tokens per second — slow enough to read as broken. So a
VPS always pairs with a hosted model, and 1–2 GB of RAM is enough for everything
this container actually does.

| | |
|---|---|
| RAM | 1–2 GB |
| Disk | 20 GB is generous |
| Model | Groq, as above. Not local. |

### 2.2 Run it

```bash
git clone https://github.com/<you>/ai-avatar.git luxora && cd luxora

docker build -t luxora .
docker volume create luxora-data

docker run -d --name luxora --restart unless-stopped \
  -p 127.0.0.1:8080:8080 \
  -e LUXORA_SECRET="$(openssl rand -base64 48)" \
  -e GROQ_API_KEY=gsk_... \
  -v luxora-data:/home/user/app/knowledge \
  luxora
```

The volume is what makes this worth paying for — accounts, catalog and documents
survive `docker restart` and redeploys.

### 2.3 HTTPS is not optional

Bound to `127.0.0.1` above, so nothing is exposed until a proxy terminates TLS.
Caddy is two lines and gets a certificate on its own:

```
your-domain.com {
    reverse_proxy 127.0.0.1:8080
}
```

Without HTTPS the microphone does not work, and the Studio's bearer token travels
in clear text.

---

## 3. What will not work

| | Why |
|---|---|
| **Vercel, Netlify, Lambda** | Serverless. Eight backend modules write to disk and three run background threads; the filesystem is ephemeral and read-only, and function timeouts are shorter than clip conforming (~20s) or try-on (10–30s). Excellent for the frontend, wrong for this backend. |
| **Shared hosting** (cPanel, Hostinger Premium/Business) | No Docker, no long-running Python, no root. |
| **Any host, for try-on** | Needs a paid Replicate or fal.ai key regardless of where it runs. There is no free garment-swap API. |
| **Any host, for lip-sync** | Not implemented anywhere yet. |

---

## 4. Honest status of this document

The Dockerfile in this repository has **not been built** — Docker was unavailable
on the machine where this was written, so the build itself is unverified.

What *has* been verified, by running the application:

- Cloud role with a Groq key registers `/api/chat` and reaches Groq, **without
  importing faster-whisper**, so the image stays small.
- Cloud role without one runs everything else and leaves `/api/chat` absent.
- A genuinely empty database seeds 12 products across 9 categories on startup,
  and never re-seeds over real data.
- Edge role still resolves to local Ollama and Whisper, unchanged.

The first `docker build` may still need a fix. Run it before the demo, not during.
