"""Check an avatar's footage against the constraints that quietly ruin the illusion.

    python check_footage.py            (checks every avatar)
    python check_footage.py nova       (checks one)

Every rule here exists because breaking it looks wrong in a way that is hard to
diagnose by eye — a grey rectangle you assume is a CSS bug, a crossfade that
jumps and you blame the code.
"""

import sys
from pathlib import Path

import av
import numpy as np

AVATARS = Path(__file__).resolve().parent / "frontend" / "public" / "avatars"

# Final durations, after conform_footage.py has ping-ponged them — so generate
# roughly half of these. Idle is the long one because it plays whenever nobody
# is talking, and a short loop is a loop the eye catches. The rest only ever
# play for a few seconds at a stretch, so their length barely matters.
CLIPS = {
    "idle.mp4": (25, 40),
    "listen.mp4": (6, 12),
    "think.mp4": (4, 12),
    "speak.mp4": (8, 16),
}

ok, warn, fail = "  ok  ", " warn ", " FAIL "
problems = 0


def say(status: str, message: str) -> None:
    global problems
    if status is fail:
        problems += 1
    print(f"[{status}] {message}")


def rgb(values) -> str:
    return "#" + "".join(f"{int(round(v)):02X}" for v in values)


def first_frame(container, stream):
    for frame in container.decode(stream):
        return frame.to_ndarray(format="rgb24")
    return None


def check(folder: Path, name: str, low: float, high: float) -> None:
    path = folder / name
    if not path.exists():
        say(fail, f"{name} is missing")
        return

    with av.open(str(path)) as container:
        video = next((s for s in container.streams if s.type == "video"), None)
        if video is None:
            say(fail, f"{name} has no video stream")
            return

        if any(s.type == "audio" for s in container.streams):
            say(fail, f"{name} has an audio track - strip it, the clips are silent")

        duration = float(container.duration or 0) / av.time_base
        if not low <= duration <= high:
            say(warn, f"{name} is {duration:.1f}s, wanted {low:.0f}-{high:.0f}s")
        else:
            say(ok, f"{name} {duration:.1f}s")

        w, h = video.codec_context.width, video.codec_context.height
        if h <= w:
            say(fail, f"{name} is {w}x{h} - portrait only")
        elif abs((h / w) - (16 / 9)) > 0.35:
            say(warn, f"{name} is {w}x{h} - not 9:16, will letterbox in the frame")
        else:
            say(ok, f"{name} {w}x{h} portrait")

        frame = first_frame(container, video)

    if frame is None:
        say(fail, f"{name} decoded no frames")
        return

    # The killer. Limited-range H.264 decodes white to about 235,235,235, which
    # puts a visible grey rectangle on a white page and destroys the illusion
    # that she is standing inside the cabinet.
    corners = np.concatenate([
        frame[:24, :24].reshape(-1, 3),
        frame[:24, -24:].reshape(-1, 3),
        frame[-24:, :24].reshape(-1, 3),
        frame[-24:, -24:].reshape(-1, 3),
    ])
    white = corners.mean(axis=0)
    if white.min() >= 250:
        say(ok, f"{name} background {rgb(white)} reads as white")
    elif white.min() >= 230:
        say(
            fail,
            f"{name} background is {rgb(white)}, not 255 - "
            "re-encode full range (-color_range pc) or it shows as a grey box",
        )
    else:
        say(warn, f"{name} corners are {rgb(white)} - not a white backdrop?")


def check_avatar(folder: Path) -> None:
    print(f"=== {folder.name} ===")

    if (folder / "poster.png").exists():
        say(ok, "poster.png present")
    else:
        say(fail, "no poster.png - conform_footage.py writes it from idle")

    for name, (low, high) in CLIPS.items():
        print()
        check(folder, name, low, high)


def main(argv: list[str]) -> int:
    if not AVATARS.is_dir():
        print(f"no avatars yet. Expected: {AVATARS}\\<name>\\")
        return 1

    wanted = [AVATARS / a.lower() for a in argv] or sorted(
        d for d in AVATARS.iterdir() if d.is_dir()
    )
    if not wanted:
        print(f"no avatar folders in {AVATARS}")
        return 1

    for folder in wanted:
        if not folder.is_dir():
            say(fail, f"no such avatar: {folder.name}")
            continue
        check_avatar(folder)
        print()

    if problems:
        print(f"{problems} thing(s) will look wrong. Fix those before judging the crossfade.")
    else:
        print("Footage looks right. Reload the page.")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
