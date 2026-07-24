"""Shared LORA_INFO assembly.

Two nodes build LORA_INFO entries: the Power Lora Loader (which applies the
LoRAs and emits their metadata in one shot) and the legacy Lora Collector (which
scrapes rgthree's Power Lora Loader back off the prompt). Both funnel through the
same builder here so MetadataCompiler consumes either source identically — keep
the dict shape in lock-step with what MetadataCompiler reads.
"""

import os
from typing import Any

from .hashing import get_sha256
from .file_utils import full_lora_path_for
from .civitai import get_civitai_info

_MODEL_EXTS = {".safetensors", ".ckpt", ".pt", ".pth", ".bin"}


def clean_lora_name(lora_path: str) -> str:
    """Display name from a path like 'qwen/jib_qwen_fix.safetensors' -> 'jib_qwen_fix'."""
    basename = os.path.basename(lora_path)
    name, ext = os.path.splitext(basename)
    return name if ext.lower() in _MODEL_EXTS else basename


def build_lora_info(
    lora_path_name: str,
    weight: float,
    enabled: bool,
    download_civitai_data: bool = True,
) -> dict[str, Any]:
    """One LORA_INFO entry: name/path/weight/enabled, plus hash + CivitAI when resolvable."""
    info: dict[str, Any] = {
        "name": clean_lora_name(lora_path_name),
        "path": lora_path_name,
        "weight": weight,
        "enabled": enabled,
    }

    full_path = full_lora_path_for(lora_path_name)
    if full_path:
        lora_hash = get_sha256(full_path)[:10]
        info["hash"] = lora_hash

        if download_civitai_data:
            civitai_info = get_civitai_info(full_path, lora_hash)
            if civitai_info:
                civitai_data: dict[str, Any] = {
                    "modelName": civitai_info.get("model", {}).get("name", ""),
                    "versionName": civitai_info.get("name", ""),
                }
                if "air" in civitai_info:
                    civitai_data["air"] = civitai_info["air"]
                elif "id" in civitai_info:
                    civitai_data["modelVersionId"] = civitai_info["id"]
                info["civitai"] = civitai_data

    return info
