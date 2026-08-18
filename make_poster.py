"""Turn any photo of a person into an avatar poster.

    python make_poster.py krish path\\to\\photo.png
    python make_poster.py krish photo.png --waist-up

Cuts the subject out of whatever background they were shot on, places them on
pure white, and crops to the frame the renderer expects.

Full body by default, at 9:16 — the shape of a standing person and the shape of
a transparent OLED cabinet. `--waist-up` gives the 3:4 head-and-torso framing
instead, which reads better on a normal monitor because the face is larger.

The problem this exists to solve: a studio grey or off-white backdrop renders as
a visible rectangle against the page's #FFFFFF, and it looks exactly like a CSS
bug.
"""

import sys
from pathlib import Path

from PIL import Image
from rembg import remove

AVATARS = Path(__file__).resolve().parent / "frontend" / "public" / "avatars"

# (width, height, share of frame the subject fills, headroom above them)
# Full body is flush to the bottom edge — his feet stand on the floor of the
# cabinet, and every spare pixel goes above his head. Fill + headroom must sum
# to 1.0 or there is a white gap under him.
FULL_BODY = (1080, 1920, 0.93, 0.07)
WAIST_UP = (1080, 1440, 0.73, 0.10)


def make(source: Path, name: str, waist_up: bool = False) -> Path:
    width, height, fill, headroom = WAIST_UP if waist_up else FULL_BODY

    out_dir = AVATARS / name.lower()
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / "poster.png"

    print(f"  cutting out the subject ({source.name})")
    cutout = remove(Image.open(source).convert("RGBA"))

    # rembg does not return a clean zero alpha for the background — it leaves a
    # faint haze of 1-6 across the whole frame. Pasted onto white that composites
    # to about #FDFDFD, which is invisible until the poster sits next to real
    # #FFFFFF and then reads as a grey rectangle around him: the exact CSS-bug
    # lookalike this script exists to prevent.
    #
    # The cutoff is low on purpose. Genuine anti-aliased edge pixels run from
    # roughly 30 upwards, so they survive and his outline stays soft; only the
    # haze is snapped to nothing.
    alpha = cutout.getchannel("A").point(lambda a: 0 if a < 8 else a)
    cutout.putalpha(alpha)

    box = cutout.getchannel("A").getbbox()
    if box is None:
        raise SystemExit("nothing found in the image - no subject to cut out")
    subject = cutout.crop(box)

    if waist_up:
        # Faces read; shoes do not.
        subject = subject.crop((0, 0, subject.width, int(subject.height * 0.62)))

    scale = (height * fill) / subject.height
    subject = subject.resize(
        (max(1, round(subject.width * scale)), round(height * fill)), Image.LANCZOS
    )

    canvas = Image.new("RGB", (width, height), (255, 255, 255))
    # Paste through the alpha channel so the edges stay soft against the white.
    canvas.paste(subject, ((width - subject.width) // 2, round(height * headroom)), subject)
    canvas.save(out)

    # Sample the whole background, not one corner. A corner can be clean while
    # the rest of the frame carries the haze, which is how a poster shipped at
    # #FDFDFD in the first place.
    pixels = canvas.load()
    strays = sum(
        1
        for y in range(0, height, 9)
        for x in range(0, width, 9)
        if pixels[x, y] != (255, 255, 255) and pixels[x, y] > (235, 235, 235)
    )

    print(f"  {width}x{height}, subject fills {fill:.0%} of the height")
    if strays:
        print(f"  WARNING: {strays} near-white background pixels are not pure white.")
        print("  On a white page that reads as a grey rectangle around the subject.")
    else:
        print("  background is true white")
    print(f"  wrote {out}")
    return out


def main(argv: list[str]) -> int:
    args = [a for a in argv if not a.startswith("--")]
    if len(args) < 2:
        print(__doc__)
        return 1

    name, source = args[0], Path(args[1])
    if not source.exists():
        raise SystemExit(f"missing: {source}")

    make(source, name, waist_up="--waist-up" in argv)
    print(f"\nSet VITE_AVATAR={name.lower()} and reload.")
    print("He will stand still until the clips exist - see frontend/public/README.md.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
