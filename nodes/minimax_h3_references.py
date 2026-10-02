"""MiniMax H3 Reference to Video, with room for more references.

**The stock node's limits are its schema's, not the model's.** `MiniMaxH3ReferenceToVideo`
declares its reference inputs as `io.Autogrow` with `max` 9 images, 3 videos, 3 video
soundtracks and 3 audios, and its `execute` walks whatever it is handed: the text encoder
numbers `<Video k>` as it goes and the DiT takes the reference blocks as a list. Three
characters bound as sets fill every video slot, which leaves no room for a location's set
or for a cut's continuation source.

This node declares the same inputs with higher limits and hands `execute` to the stock
node, so what a reference means and how it is encoded stay core's. It is not a subclass:
ComfyUI caches a node's description, category and return types on the class, and a
subclass would read the stock node's cached values.

Every reference rides every sampling step, so each one added is render time.
"""

from __future__ import annotations

from comfy_api.latest import io
from comfy_extras.nodes_minimax_h3 import MiniMaxH3ReferenceToVideo as Stock

NODE_ID = "MiniMax H3 Reference to Video (Mottoes)"

#: Autogrow container -> how many slots it declares. A video's soundtrack is paired with
#: the video by index, so the two containers stay the same size.
LIMITS = {"ref_images": 16, "ref_videos": 16, "ref_video_audios": 16, "ref_audios": 16}


def _widened(item):
    """One stock input, with its Autogrow limit raised when it is one of `LIMITS`."""
    if not isinstance(item, io.Autogrow.Input) or item.id not in LIMITS:
        return item
    template = item.template
    return io.Autogrow.Input(
        item.id, optional=item.optional,
        template=io.Autogrow.TemplatePrefix(input=template.input, prefix=template.prefix,
                                            min=template.min, max=LIMITS[item.id]))


class MiniMaxH3ReferenceToVideoMany(io.ComfyNode):
    """`MiniMaxH3ReferenceToVideo` with up to 16 references of each kind."""

    @classmethod
    def define_schema(cls):
        stock = Stock.define_schema()
        return io.Schema(
            node_id=NODE_ID,
            display_name=NODE_ID,
            category=stock.category,
            description=(stock.description + " The stock node with up to "
                         f"{LIMITS['ref_videos']} references of each kind."),
            inputs=[_widened(item) for item in stock.inputs],
            outputs=stock.outputs,
        )

    @classmethod
    def execute(cls, **inputs) -> io.NodeOutput:
        return Stock.execute(**inputs)
