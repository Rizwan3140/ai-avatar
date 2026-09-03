"""Turn raw AI-generated clips into footage this app can actually use.

    python conform_footage.py nova raw/idle.mp4 raw/listen.mp4 ...
    python conform_footage.py nova raw/            (whole folder)

Installs into frontend/public/avatars/<name>/, which is all it takes to add an
avatar — set VITE_AVATAR=<name> to put her on the kiosk.

Does four things, each of which is a bug you would otherwise chase in CSS:

  portrait crop     so she fills a 3:4 frame and never letterboxes
  full-range white  so #FFFFFF stays #FFFFFF instead of decoding to ~#EBEBEB
  audio stripped    the clips are silent by design
  ping-pong loop    AI generators do not produce seamless loops; playing the
                    clip forwards then backwards always joins perfectly

Ping-pong is why this exists. A visible seam every few seconds is the fastest
way to stop reading as a person, and no amount of code hides it.
"""

import subprocess
import sys
from pathlib import Path

AVATARS = Path(__file__).resolve().parent / "frontend" / "public" / "avatars"
NAMES = {"idle", "listen", "think", "speak"}

# 9:16 — a standing figure, and the shape of a transparent OLED cabinet.
WIDTH, HEIGHT = 1080, 1920


def conform(sources: list[Path], name: str, out_dir: Path, pingpong: bool = True) -> None:
    out = out_dir / f"{name}.mp4"

    # Cover-crop to portrait, then force full-range output. Both the filter and
    # the container flag are needed — set only one and players disagree.
    # Snap near-white to pure white. Generators land a degree or two off #FFFFFF
    # and never on the same value twice, so crossfading two clips would shift the
    # whole background brightness — far more visible than a static offset,
    # because motion draws the eye. Only the top 1.5% is touched, which is
    # backdrop and specular highlights, not skin or clothing.
    whiten = "colorlevels=rimax=0.985:gimax=0.985:bimax=0.985"

    scale = (
        f"scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=increase,"
        f"crop={WIDTH}:{HEIGHT},setsar=1,{whiten},scale=out_range=full"
    )

    # Generators cap out around ten seconds, so a long idle is several clips
    # joined end to end. Scale each before concatenating — they may not share a
    # resolution.
    parts = "".join(f"[{i}:v]{scale}[s{i}];" for i in range(len(sources)))
    joined = "".join(f"[s{i}]" for i in range(len(sources)))
    graph = f"{parts}{joined}concat=n={len(sources)}:v=1[j]"

    if pingpong:
        graph += ";[j]split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1[v]"
    else:
        graph += ";[j]copy[v]"

    cmd = [
        "ffmpeg", "-y",
        *[arg for source in sources for arg in ("-i", str(source))],
        "-filter_complex", graph, "-map", "[v]",
        "-an",                       # no audio track
        # `veryfast`, not `slow`. At a fixed CRF the preset trades encoding time
        # against file size, not against quality — and measured on this
        # project's own footage at 2160x3840 it was 15s versus 4s for six
        # seconds of video, with the faster preset producing the *smaller*
        # file. There was no trade to make.
        #
        # It matters because this runs inside the upload request: the browser
        # says "uploading" while ffmpeg re-encodes 4K, and a person watching a
        # spinner for two minutes concludes the upload is broken.
        "-c:v", "libx264", "-crf", "18", "-preset", "veryfast",
        "-pix_fmt", "yuv420p",
        "-color_range", "pc",        # full range, or white lands at ~235
        "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
        "-movflags", "+faststart",
        str(out),
    ]

    joined_names = " + ".join(s.name for s in sources)
    print(f"  {joined_names} -> {out.name}{' (ping-pong)' if pingpong else ''}")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(result.stderr[-1500:])
        # `sources`, not `source` — the singular never existed in this scope, so
        # every ffmpeg failure raised NameError and hid its own error message.
        raise SystemExit(f"ffmpeg failed on {joined_names}")


def poster_from(source: Path, out_dir: Path) -> None:
    """First frame of idle, so boot shows her rather than a blank panel."""
    out = out_dir / "poster.png"
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(source), "-vframes", "1",
         "-vf", f"scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=increase,"
                f"crop={WIDTH}:{HEIGHT},scale=out_range=full",
         str(out)],
        capture_output=True, check=True,
    )
    print(f"  {source.name} -> poster.png")


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 1

    avatar, *sources = argv
    out_dir = AVATARS / avatar.lower()

    # A folder argument means "take everything in it".
    paths: list[Path] = []
    for arg in sources:
        path = Path(arg)
        paths.extend(sorted(path.glob("*.mp4")) if path.is_dir() else [path])

    # Group by pose, so idle1.mp4 + idle2.mp4 become one long idle.mp4.
    jobs: dict[str, list[Path]] = {}
    for path in sorted(paths):
        pose = next((n for n in NAMES if path.stem.lower().startswith(n)), None)
        if pose is None:
            print(f"skipping {path.name}: name it {sorted(NAMES)} (idle2.mp4 is fine)")
            continue
        if not path.exists():
            raise SystemExit(f"missing: {path}")
        jobs.setdefault(pose, []).append(path)

    if not jobs:
        print("nothing to do")
        return 1

    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"installing into {out_dir}\n")
    for pose, sources in jobs.items():
        # Speaking motion reversed still reads as speaking; it is not lip-synced
        # to anything anyway. Reversed breathing and blinking read perfectly.
        conform(sources, pose, out_dir)
        if pose == "idle":
            poster_from(sources[0], out_dir)

    print(f"\nNow run:  python check_footage.py {avatar}")
    if avatar.lower() != "nova":
        print(f"And set:  VITE_AVATAR={avatar.lower()}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
