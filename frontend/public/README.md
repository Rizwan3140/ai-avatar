# Avatar workflow

One portrait image in, four clips out, installed under her name.

```
frontend/public/avatars/
├── nova/          <- the default; VITE_AVATAR picks another
│   ├── poster.png
│   ├── idle.mp4
│   ├── listen.mp4
│   ├── think.mp4
│   └── speak.mp4
└── aurora/
    └── ...
```

Adding an avatar is a folder. No code changes.

---

## The workflow

### 0. Already have a photo of a person?

```powershell
.\.venv\Scripts\python.exe make_poster.py krish "path\to\photo.png"
```

Cuts the subject out, drops them on true white, frames them full body at 9:16.
`--waist-up` gives 3:4 head-and-torso instead, which reads better on a desk
monitor because the face is larger. Either way she or he is on screen
immediately, standing still, before any video exists.

### 1. One portrait — the source of truth

Everything is generated **from this single image**. Midjourney, Flux, DALL·E, or
a stock photo.

> Photorealistic portrait of a professional woman in her late twenties, standing,
> facing camera, warm neutral expression, looking directly at the lens. Tailored
> off-white blazer over a white top, no logos. Hands relaxed at her sides.
> Waist-up, centered, occupying about 70% of frame height. Pure white seamless
> background. Soft diffuse studio lighting, even, no shadows, no vignette.
> 85mm. 3:4 portrait.

A **T-pose is the wrong input here.** T-pose is for rigging a 3D character. This
is a photoreal digital human — you want the exact frame you want her to stand in,
because that frame becomes every clip.

Two things to get right, because they are unfixable later:
- **Pure white background.** The page behind her is `#FFFFFF`; anything off-white
  shows as a grey rectangle.
- **Framing you are happy with.** All four clips inherit it.

### 2. Four clips — same image, four motion prompts

Feed the **same portrait** to an image-to-video model four times. Image-to-video
preserves the first frame, so identical input gives identical framing for free.
That is the entire trick: the clips are crossfaded on top of each other, and if
she sits 20px higher in one, every state change twitches.

Do not write four text-to-video prompts. They will not match.

Keep every setting identical between runs — same model, same duration, same
motion strength. Only the prompt changes.

| clip | prompt | wanted |
|---|---|---|
| `idle` | *She stands still and breathes gently. Occasional natural blinks. Very subtle head movement. Mouth closed and relaxed. Calm and neutral. No talking.* | 25–40s |
| `listen` | *She listens attentively with direct eye contact, a slight forward lean, occasional small understanding nod. Mouth closed. Engaged and interested.* | 6–10s |
| `think` | *Her eyes drift upward and to the side as she considers something, a brief thoughtful expression, then she returns her gaze to camera.* | 4–8s |
| `speak` | *She speaks naturally to camera, animated mouth movement, expressive eyebrows, small head movements and nods. Warm and engaging.* | 8–12s |

Generators cap around 5–10s, so `idle` needs several runs from the same image,
concatenated. Its length matters most — a short idle loop is a loop the eye
catches within a minute, and that is what breaks the spell while nobody is
talking.

**Name the downloads `idle.mp4`, `listen.mp4`, `think.mp4`, `speak.mp4`** and put
them in any scratch folder. The script reads the pose from the filename.

### 3. Conform and install

```powershell
cd "D:\ai avatar"
.\.venv\Scripts\python.exe conform_footage.py nova raw\
.\.venv\Scripts\python.exe check_footage.py nova
```

`conform_footage.py <name> <files-or-folder>` crops to portrait 1080×1440, strips
the audio track, forces full-range colour so white stays white, writes
`poster.png` from idle's first frame, **ping-pongs every clip** so it loops
seamlessly, and installs everything into `avatars/<name>/`.

Ping-pong is why this script exists. Generators do not produce loopable clips, and
playing forwards-then-backwards always joins perfectly.

### 4. Use her

`nova` is the default and needs nothing. For any other name:

```powershell
$env:VITE_AVATAR = "aurora"; npm run dev
```

Vite serves `public/` directly, so a reload picks up new footage. No rebuild.

---

## Generation has to be cloud

This machine has an RTX 2050 with **4 GB VRAM**. Local image-to-video (Stable
Video Diffusion, Wan, CogVideo) needs 8–12 GB minimum, so it is not an option
here. Kling, Hedra, Runway and Hailuo all do image-to-video and all have free
tiers; any of them fits this workflow because all four clips come from one image.

**The one local alternative worth knowing:** LivePortrait runs in about 2 GB and
retargets a portrait onto a driving video. Record yourself once doing the four
behaviours, and every future avatar is free and offline forever — same motion,
any face. More setup, no per-clip cost, and it fits this GPU.

## What `check_footage.py` catches

Portrait 9:16 (1080×1920) · no audio track · durations in range · corner pixels
at `#FFFFFF`. That last one is the expensive trap: AI "white" backgrounds are
routinely `#F5F5F5` or vignetted, which renders as a grey panel on a white page
and looks exactly like a CSS bug.

It **cannot** check whether the four clips line up. Only your eyes on the real
crossfade can, and nothing downstream survives getting that wrong.
