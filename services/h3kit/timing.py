"""Frame arithmetic for MiniMax H3.

Read out of `comfy_extras/nodes_minimax_h3.py`, not from documentation. `align_frame_count`
there steps until `n % 17 == 5`, so the legal frame counts are 5, 22, 39, 56, 73, 90, 107,
124 … — a legal duration every ~0.708 s at 24 fps — and **any request is rounded up
silently**.

That silence is why this module exists on its own. `docs/DESIGN.md` § 6 names computing
timestamps against the *requested* seconds rather than the *aligned* frame count as the
single most likely correctness bug in the feature: the prompt's clock ends up a fraction
ahead of the clip's, and the drift accumulates across every cut. Everything downstream
takes its seconds from `align_seconds()`, never from what the author typed.
"""

from __future__ import annotations

FPS = 24
FRAME_MODULUS = 17
FRAME_RESIDUE = 5
MIN_FRAMES = 5

# The node's own tooltip: "trained range is ~124-362". Legal outside it, so these are
# advisory bounds for the validator rather than limits enforced here.
TRAINED_MIN_FRAMES = 124
TRAINED_MAX_FRAMES = 362

__all__ = [
    "FPS", "MIN_FRAMES", "TRAINED_MIN_FRAMES", "TRAINED_MAX_FRAMES",
    "align_frames", "frames_for", "seconds_for", "align_seconds", "timecode",
]


def align_frames(frames: int) -> int:
    """Round *up* to the next legal frame count, mirroring the node exactly.

    >>> align_frames(72), align_frames(73), align_frames(288)
    (73, 73, 294)
    """
    n = max(MIN_FRAMES, int(frames))
    while n % FRAME_MODULUS != FRAME_RESIDUE:
        n += 1
    return n


def frames_for(seconds: float) -> int:
    """The aligned frame count a request of `seconds` actually produces.

    Rounds the seconds→frames conversion to nearest first so floating point cannot drop
    a request of exactly 3.042 s to 72 frames and then align it back up to 73 — same
    answer, but by luck rather than by construction.
    """
    return align_frames(round(float(seconds) * FPS))


def seconds_for(frames: int) -> float:
    return frames / FPS


def align_seconds(seconds: float) -> float:
    """What the author asked for, as the clip will actually run.

    >>> round(align_seconds(3.0), 3), round(align_seconds(12.2), 3)
    (3.042, 12.25)
    """
    return seconds_for(frames_for(seconds))


def timecode(seconds: float) -> str:
    """`MM:SS.mmm`, the format the guide requires for a cut time.

    >>> timecode(0), timecode(2.5), timecode(9.0), timecode(75.25)
    ('00:00.000', '00:02.500', '00:09.000', '01:15.250')
    """
    total_ms = int(round(float(seconds) * 1000))
    minutes, remainder = divmod(total_ms, 60_000)
    secs, ms = divmod(remainder, 1000)
    return f"{minutes:02d}:{secs:02d}.{ms:03d}"
