"""MiniMax H3 Canvas — say aspect, area and duration; get width, height and frames.

**Why this node exists.** H3's `MiniMaxH3ReferenceToVideo` takes `width`, `height` and
`length` as three raw numbers, and none of them can be picked freely: each axis has to land
on a multiple of 32, and the frame count has to satisfy `n % 17 == 5` (5, 22, 39, 56 ... a
legal duration every ~0.708s at 24fps). So a graph exported with those three typed in is a
graph you cannot safely edit. Bump the quality down to look at the blocking and you are
doing square roots by hand to find a legal 0.4-megapixel 16:9 canvas; change the duration
and you are counting in seventeens.

That pushed the arithmetic outside the workflow, into whatever submitted it, which meant
the exported graph only ran correctly when something else drove it. This node puts the
three rules back inside the graph, so the same file can be opened in ComfyUI, re-tiered,
re-timed, or hung off a different sampler, and still be right.

**Duration is a ceiling, not a specification.** You ask for about fifteen seconds; H3 paces
what happens inside them. `seconds` therefore rounds UP to the next legal frame count and
reports what you actually get on the `seconds` output -- the same direction the model's own
`align_frame_count` rounds, so nothing is silently trimmed.

Nothing is clamped to H3's trained range (~124-362 frames at 24fps). Outside it is legal
and out of distribution, which is a thing to be told about rather than prevented.

The arithmetic is `services/h3kit`, copied byte-for-byte from Gallery's compiler so the two
cannot disagree about what a clip is. See that package's docstring.
"""

from __future__ import annotations

from typing import Any

from ..services.h3kit import (NATIVE_MEGAPIXELS, TRAINED_MAX_FRAMES, TRAINED_MIN_FRAMES,
                              FPS, align_frames, canvas_for, parse_aspect, seconds_for)

#: Named in the tooltip rather than offered as a dropdown, deliberately. A combo would
#: reject any ratio not on the list -- including one an application passes in from a
#: project's own settings -- and the failure would arrive as a validation error about a
#: value that is perfectly legal. `parse_aspect` accepts `:`, `x` or `/`.
COMMON_ASPECTS = ("16:9", "9:16", "4:3", "3:4", "1:1", "21:9", "2:3", "3:2")


class MiniMaxH3Canvas:
    """Aspect + megapixels + seconds -> the three numbers H3 actually takes."""

    CATEGORY = "Mottoes"
    FUNCTION = "derive"
    RETURN_TYPES = ("INT", "INT", "INT", "FLOAT", "FLOAT")
    RETURN_NAMES = ("width", "height", "length", "fps", "seconds")
    OUTPUT_TOOLTIPS = (
        "Canvas width, on a multiple of 32.",
        "Canvas height, on a multiple of 32.",
        "Frame count, rounded up to the next legal n % 17 == 5.",
        "24.0 — H3's frame rate. Wire it to Create Video so the number lives in one place.",
        "What the clip will actually run for, which is `seconds` rounded up to that frame count.",
    )
    DESCRIPTION = ("Derive a legal MiniMax H3 canvas and frame count from an aspect ratio, "
                   "an area in megapixels and a duration in seconds.")

    @classmethod
    def INPUT_TYPES(cls) -> dict[str, Any]:
        return {
            "required": {
                "aspect_ratio": ("STRING", {
                    "default": "16:9", "multiline": False,
                    "tooltip": "w:h — e.g. " + ", ".join(COMMON_ASPECTS)
                               + ". 'x' and '/' work as separators too.",
                }),
                "megapixels": ("FLOAT", {
                    "default": NATIVE_MEGAPIXELS, "min": 0.01, "max": 8.0, "step": 0.001,
                    "tooltip": "Canvas area. H3's own trained canvas is 1344x768 — about "
                               f"{NATIVE_MEGAPIXELS:.3f} MP — so that is the default. Drop it "
                               "to look at the blocking cheaply; the aspect does not change.",
                }),
                "seconds": ("FLOAT", {
                    "default": 15.0, "min": 0.2, "max": 120.0, "step": 0.01,
                    "tooltip": "Roughly how long, as a ceiling. Rounded UP to the next legal "
                               "frame count; the `seconds` output says what you got.",
                }),
            },
        }

    def derive(self, aspect_ratio: str, megapixels: float, seconds: float):
        # `parse_aspect` and `canvas_for` raise ValueError on nonsense ("16-9", a negative
        # area). Letting that out is the right behaviour: ComfyUI reports it against this
        # node, which is where the wrong value was typed, rather than failing later inside
        # H3 with a message about tensor shapes.
        parse_aspect(aspect_ratio)
        width, height = canvas_for(aspect_ratio, float(megapixels))
        length = align_frames(round(float(seconds) * FPS))
        return (width, height, length, float(FPS), seconds_for(length))

    @classmethod
    def VALIDATE_INPUTS(cls, aspect_ratio: str = "16:9", megapixels: float = NATIVE_MEGAPIXELS,
                        seconds: float = 15.0, **_kwargs):
        """Say what is wrong before the models load, not after.

        Out-of-distribution is reported by the application that owns the clip; what is
        checked here is only what makes the node unable to produce a number at all.
        """
        try:
            parse_aspect(str(aspect_ratio))
        except ValueError as exc:
            return str(exc)
        if float(megapixels) <= 0:
            return f"megapixels must be positive, got {megapixels!r}"
        if float(seconds) <= 0:
            return f"seconds must be positive, got {seconds!r}"
        return True


#: Advisory only, and not enforced anywhere in this file — kept so a reader of the node
#: does not have to go looking for what "trained range" means.
TRAINED_RANGE = (TRAINED_MIN_FRAMES, TRAINED_MAX_FRAMES)
