"""A byte-identical copy of two pure modules from Gallery's `h3kit`.

**These files are copies, and they must stay copies.** They are `packages/h3kit/h3kit/
canvas.py` and `timing.py` from johna101/gallery, taken verbatim rather than adapted, so
that "has this drifted?" is answered by `filecmp` and not by reading. Gallery's own suite
carries the test that asserts it (`VendoredCanvasTests`), because Gallery is the side that
knows where both checkouts live.

**Why a copy at all.** Gallery compiles a clip and submits it; this node computes the same
canvas inside ComfyUI so the exported graph can be opened and driven by hand. Both need the
same two rules -- snap each axis to a multiple of 32, and round the frame count up to the
next `n % 17 == 5` -- and a graph whose arithmetic disagreed with the application's would
render a different clip depending on who pressed the button.

Both modules are stdlib-only by construction (`h3kit`'s `pyproject.toml` declares no
dependencies and a test asserts it), which is what makes copying them viable.

If you are editing these files: don't. Edit them in Gallery and re-copy.
"""

from .canvas import CANVAS_MULTIPLE, NATIVE_MEGAPIXELS, aspect_of, canvas_for, parse_aspect
from .timing import (FPS, TRAINED_MAX_FRAMES, TRAINED_MIN_FRAMES, align_frames,
                     align_seconds, frames_for, seconds_for, timecode)

__all__ = [
    "CANVAS_MULTIPLE", "NATIVE_MEGAPIXELS", "aspect_of", "canvas_for", "parse_aspect",
    "FPS", "TRAINED_MAX_FRAMES", "TRAINED_MIN_FRAMES", "align_frames", "align_seconds",
    "frames_for", "seconds_for", "timecode",
]
