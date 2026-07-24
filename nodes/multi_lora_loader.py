"""Multi Lora Loader — stack any number of LoRAs with a modern Vue editor UX.

A single node that applies N LoRAs onto a MODEL/CLIP, each with its own on/off
toggle and strength, edited in a Vue app (js/lora/editor.js) mounted into a DOM
widget. A native alternative to rgthree's Power Lora Loader.

Unlike rgthree — which serialises one flexible ``lora_N`` input per row that a
separate collector scrapes back off the prompt — this node keeps the whole stack
in a single JSON ``loras`` widget and emits LORA_INFO directly (name, hash,
weight, CivitAI metadata), so a downstream metadata node can consume it with no
separate collector and no prompt introspection.

The ``loras`` widget holds a JSON array of rows::

    {"on": bool, "lora": "path/name.safetensors", "strength": float,
     "strengthClip": float | null}

``strengthClip`` is optional; when absent/null the model strength is used for CLIP
too (matching a plain LoraLoader with a single strength).

Everything above the node class is dependency-free so ``tests/`` can exercise the
row parsing without a running ComfyUI.
"""

from __future__ import annotations

import json
from typing import Any


def _as_float(value: Any, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def coerce_rows(loras: Any) -> list[dict[str, Any]]:
    """Parse the ``loras`` widget value (JSON string or list) into row dicts.

    Rows without a ``lora`` name are dropped — an empty picker row applies and
    describes nothing.
    """
    if isinstance(loras, str):
        text = loras.strip()
        if not text:
            return []
        try:
            loras = json.loads(text)
        except (ValueError, TypeError):
            return []
    if not isinstance(loras, list):
        return []
    return [r for r in loras if isinstance(r, dict) and r.get("lora")]


class MultiLoraLoader:
    """Apply any number of LoRAs to a MODEL/CLIP and emit their metadata."""

    @classmethod
    def INPUT_TYPES(cls) -> dict[str, Any]:
        return {
            "required": {
                # Backed by a Vue DOM widget on the frontend; the default keeps a
                # bare (JS-less) load valid and round-trips as an empty stack.
                "loras": ("STRING", {"multiline": True, "default": "[]"}),
            },
            "optional": {
                "model": ("MODEL", {"tooltip": "Model to apply the LoRAs to"}),
                "clip": ("CLIP", {"tooltip": "CLIP to apply the LoRAs to"}),
                "download_civitai_data": ("BOOLEAN", {
                    "default": True,
                    "tooltip": "Download and cache CivitAI metadata for each LoRA",
                }),
                "include_disabled": ("BOOLEAN", {
                    "default": True,
                    "tooltip": "Include disabled LoRAs in lora_info (marked enabled: false)",
                }),
            },
        }

    RETURN_TYPES = ("MODEL", "CLIP", "LORA_INFO")
    RETURN_NAMES = ("MODEL", "CLIP", "lora_info")
    OUTPUT_TOOLTIPS = (
        "Model with the enabled LoRAs applied",
        "CLIP with the enabled LoRAs applied",
        "Structured LoRA metadata (name, hash, weight, CivitAI)",
    )
    FUNCTION = "load_loras"
    CATEGORY = "Mottoes"
    DESCRIPTION = (
        "Stack multiple LoRAs with a per-row toggle and strength; "
        "outputs MODEL, CLIP and LORA_INFO (no Lora Collector needed)"
    )

    def load_loras(
        self,
        loras,
        model=None,
        clip=None,
        download_civitai_data: bool = True,
        include_disabled: bool = True,
    ):
        # Imported lazily so the module stays importable (and testable) without a
        # ComfyUI runtime on sys.path.
        import comfy.sd
        import comfy.utils

        from ..services.file_utils import full_lora_path_for
        from ..services.lora_info import build_lora_info

        rows = coerce_rows(loras)
        lora_info: list[dict[str, Any]] = []
        file_cache: dict[str, Any] = {}  # full_path -> loaded state dict (one load per file)

        for row in rows:
            name = row["lora"]
            enabled = bool(row.get("on", True))
            strength = _as_float(row.get("strength"), 1.0)
            strength_clip_raw = row.get("strengthClip")
            strength_clip = (
                strength if strength_clip_raw is None
                else _as_float(strength_clip_raw, strength)
            )

            if enabled or include_disabled:
                lora_info.append(
                    build_lora_info(name, strength, enabled, download_civitai_data)
                )

            if not enabled or (strength == 0 and strength_clip == 0):
                continue
            if model is None and clip is None:
                continue

            full_path = full_lora_path_for(name)
            if not full_path:
                continue
            if full_path not in file_cache:
                file_cache[full_path] = comfy.utils.load_torch_file(full_path, safe_load=True)
            model, clip = comfy.sd.load_lora_for_models(
                model, clip, file_cache[full_path], strength, strength_clip
            )

        return (model, clip, lora_info)


# --------------------------------------------------------------------------- #
# LoRA list route (registered only when running inside ComfyUI) — powers the
# editor's picker. Mirrors the prompt-builder live-preview route.
# --------------------------------------------------------------------------- #

try:  # pragma: no cover - exercised only under a live ComfyUI server
    from aiohttp import web
    from server import PromptServer
    import folder_paths

    @PromptServer.instance.routes.get("/mottoes/loras")
    async def _list_loras_route(request):
        return web.json_response(folder_paths.get_filename_list("loras"))
except Exception:
    pass
