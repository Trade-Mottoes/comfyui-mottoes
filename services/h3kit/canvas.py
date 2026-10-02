"""Canvas derivation: an aspect and an area, rather than a pixel pair.

`docs/DESIGN.md` § 6 — size is spoken as **aspect + megapixels**, the vocabulary the LoRA
workspace adopted in v0.31, so the application has one dialect rather than two.

Two things worth being exact about, because they are easy to conflate:

- The node's `MAX_PIXELS` (768x1344) is **not** a cap on the generation canvas. It belongs
  to `adapt_canvas`, which the node calls only when resizing a *reference video*. The
  generation `width`/`height` are free between 32 and `MAX_RESOLUTION`, in steps of 32.
- H3's own defaults are 1344x768, so its trained canvas sits at about 1.03 MP. Asking for
  much more is legal and out of distribution, which makes it a validator's business rather
  than something to silently clamp here.
"""

from __future__ import annotations

import math
import re

__all__ = ["CANVAS_MULTIPLE", "NATIVE_MEGAPIXELS", "DEFAULT_ASPECT", "DEFAULT_MEGAPIXELS",
           "EXACT", "canvas_for", "parse_aspect", "aspect_of"]

CANVAS_MULTIPLE = 32
NATIVE_WIDTH, NATIVE_HEIGHT = 1344, 768
NATIVE_MEGAPIXELS = (NATIVE_WIDTH * NATIVE_HEIGHT) / 1_000_000  # ~1.032

#: What `synthesise` renders at when the caller says nothing. They live HERE and not on
#: `Clip`, because a clip does not have a canvas -- the shape belongs to the project and the
#: area to the run. This is the fallback for a caller with no opinion, which is the same
#: role `seed=None` plays: legal, and not a decision anybody made.
DEFAULT_ASPECT = "16:9"
DEFAULT_MEGAPIXELS = NATIVE_MEGAPIXELS

#: Canvases fixed by hand, as (width:height ratio, megapixels) -> pixels. The upgrade's
#: upscaler stretches a take to its target, so a target that snaps to a different shape
#: from the draft's distorts it. 16:9 does: the draft is 832x480 and 1.6 MP derives as
#: 1696x960, 1.9% wider. 1.6 MP is therefore the draft doubled. The other common aspects
#: already derive to an exact double.
EXACT = {
    (16 / 9, 1.6): (1664, 960),
    (9 / 16, 1.6): (960, 1664),
}

_ASPECT = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)\s*$")


def parse_aspect(aspect: str) -> float:
    """`"16:9"` -> 1.777…  Accepts `:`, `x` or `/` as the separator.

    >>> round(parse_aspect("16:9"), 4), round(parse_aspect("2:3"), 4)
    (1.7778, 0.6667)
    """
    match = _ASPECT.match(aspect)
    if not match:
        raise ValueError(f"aspect must look like '16:9', got {aspect!r}")
    width, height = float(match.group(1)), float(match.group(2))
    if width <= 0 or height <= 0:
        raise ValueError(f"aspect must be positive, got {aspect!r}")
    return width / height


def canvas_for(aspect: str, megapixels: float) -> tuple[int, int]:
    """The pixel pair for an aspect and an area, each axis on a multiple of 32.

    Rounding to 32 moves the real area a little off the request; that is the node's
    constraint, not ours, and the receipt records the pixels that actually ran. A pair in
    `EXACT` wins over the derived one.

    >>> canvas_for("16:9", 1.032)
    (1344, 768)
    >>> canvas_for("2:3", 1.0)
    (832, 1216)
    >>> canvas_for("16:9", 0.4), canvas_for("16:9", 1.6)
    ((832, 480), (1664, 960))
    """
    if megapixels <= 0:
        raise ValueError(f"megapixels must be positive, got {megapixels!r}")
    ratio = parse_aspect(aspect)
    for (exact_ratio, exact_megapixels), pair in EXACT.items():
        if math.isclose(ratio, exact_ratio) and math.isclose(megapixels, exact_megapixels):
            return pair
    pixels = megapixels * 1_000_000
    height = math.sqrt(pixels / ratio)
    width = ratio * height
    return (_snap(width), _snap(height))


def _snap(value: float) -> int:
    return max(CANVAS_MULTIPLE, int(round(value / CANVAS_MULTIPLE)) * CANVAS_MULTIPLE)


def aspect_of(width: int, height: int) -> str:
    """A readable aspect for a pixel pair, reduced where it reduces cleanly.

    Used for reporting a *derived* size. The design's rule is that a declared spec reads
    as a decision and a derived one reads bare, so this never invents a spec — it only
    describes what is already there.

    >>> aspect_of(1344, 768), aspect_of(832, 1216)
    ('7:4', '13:19')
    """
    divisor = math.gcd(int(width), int(height)) or 1
    return f"{int(width) // divisor}:{int(height) // divisor}"
