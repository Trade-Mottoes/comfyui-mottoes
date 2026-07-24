# Vendored from alexopus/ComfyUI-Image-Saver (originally giriss/comfy-image-saver),
# MIT License, Copyright (c) 2023 Girish Gopaul. See NOTICE.
import os
import re
import requests
import json
from pathlib import Path
from typing import Optional, Any
from collections.abc import Collection, Iterator
from datetime import datetime
import folder_paths

def sanitize_filename(filename: str) -> str:
    """Remove characters that are unsafe for filenames."""
    # Remove characters that are generally unsafe across file systems
    unsafe_chars = r'[<>:"|?*\x00-\x1f]'
    sanitized = re.sub(unsafe_chars, '', filename)

    # Remove trailing periods and spaces (problematic on Windows)
    sanitized = sanitized.rstrip('. ')
    return sanitized

def full_embedding_path_for(embedding: str) -> Optional[str]:
    """
    Based on a embedding name, eg: EasyNegative, finds the path as known in comfy, including extension
    """
    matching_embedding = get_file_path_match("embeddings", embedding)
    if matching_embedding is None:
        print(f'ComfyUI-Mottoes: could not find full path to embedding "{embedding}"')
        return None
    return folder_paths.get_full_path("embeddings", matching_embedding)

def full_lora_path_for(lora: str) -> Optional[str]:
    """
    Based on a lora name, e.g., 'epi_noise_offset2', finds the path as known in comfy, including extension.
    """
    # Find the matching lora path
    matching_lora = get_file_path_match("loras", lora)
    if matching_lora is None:
        print(f'ComfyUI-Mottoes: could not find full path to lora "{lora}"')
        return None
    return folder_paths.get_full_path("loras", matching_lora)

def full_checkpoint_path_for(model_name: str) -> str:
    if not model_name:
        return ''

    supported_extensions = set(folder_paths.supported_pt_extensions) | {".gguf"}

    matching_checkpoint = get_file_path_match("checkpoints", model_name, supported_extensions)
    if matching_checkpoint is not None:
        return folder_paths.get_full_path("checkpoints", matching_checkpoint)

    matching_model = get_file_path_match("diffusion_models", model_name, supported_extensions)
    if matching_model:
        return folder_paths.get_full_path("diffusion_models", matching_model)

    print(f'Could not find full path to checkpoint "{model_name}"')
    return ''

def get_file_path_iterator(folder_name: str, supported_extensions: Optional[Collection[str]] = None) -> Iterator[Path]:
    """
    Returns an iterator over valid file paths for the specified model folder.
    """
    if supported_extensions is None:
        return (Path(x) for x in folder_paths.get_filename_list(folder_name))
    else:
        return custom_file_path_generator(folder_name, supported_extensions)

def custom_file_path_generator(folder_name: str, supported_extensions: Collection[str]) -> Iterator[Path]:
    """
    Generator function for file paths, allowing for a customized extension check.
    """
    model_paths = folder_paths.folder_names_and_paths.get(folder_name, [[], set()])[0]
    for path in model_paths:
        if os.path.exists(path):
            base_path = Path(path)
            for root, _, files in os.walk(path):
                root_path = Path(root).relative_to(base_path)
                for file in files:
                    file_path = root_path / file
                    if file_path.suffix.lower() in supported_extensions:
                        yield file_path

def get_file_path_match(folder_name: str, file_name: str, supported_extensions: Optional[Collection[str]] = None) -> Optional[str]:
    supported_extensions_fallback = supported_extensions if supported_extensions is not None else folder_paths.supported_pt_extensions
    file_path = Path(file_name)

    # first try full path match, then fallback to just name match, matching the extension if appropriate
    if file_path.suffix.lower() not in supported_extensions_fallback:
        matching_file_path = next((p for p in get_file_path_iterator(folder_name, supported_extensions) if p.with_suffix('') == file_path), None)
        matching_file_path = (matching_file_path if matching_file_path is not None else
            next((p for p in get_file_path_iterator(folder_name, supported_extensions) if p.stem == file_path.name), None))
    else:
        matching_file_path = next((p for p in get_file_path_iterator(folder_name, supported_extensions) if p == file_path), None)
        matching_file_path = (matching_file_path if matching_file_path is not None else
            next((p for p in get_file_path_iterator(folder_name, supported_extensions) if p.name == file_path.name), None))

    return str(matching_file_path) if matching_file_path is not None else None

def http_get_json(url: str) ->  dict[str, Any] | None:
    try:
        response = requests.get(url, timeout=300)
    except requests.exceptions.Timeout:
        print(f"ComfyUI-Mottoes: HTTP GET Request timed out for {url}")
        return None
    except requests.exceptions.ConnectionError as e:
        print(f"ComfyUI-Mottoes: Warning - Network connection error for {url}: {e}")
        return None

    if not response.ok:
        print(f"ComfyUI-Mottoes: HTTP GET Request failed with error code: {response.status_code}: {response.reason}")
        return None

    try:
        return response.json()
    except ValueError as e:
        print(f"ComfyUI-Mottoes: HTTP Response JSON error: {e}")
    return None

def parse_checkpoint_name(ckpt_name: str) -> str:
    return os.path.basename(ckpt_name)

def parse_checkpoint_name_without_extension(ckpt_name: str) -> str:
    filename = parse_checkpoint_name(ckpt_name)
    name_without_ext, ext = os.path.splitext(filename)
    supported_extensions = folder_paths.supported_pt_extensions | {".gguf"}

    # Only remove extension if it's a known model file extension
    if ext.lower() in supported_extensions:
        return name_without_ext
    else:
        return filename # Keep full name if extension isn't recognized

def get_timestamp(time_format: str) -> str:
    now = datetime.now()
    try:
        timestamp = now.strftime(time_format)
    except:
        timestamp = now.strftime("%Y-%m-%d-%H%M%S")

    return timestamp

def apply_custom_time_format(filename: str) -> str:
    """
    Replace %time_format<strftime_format> patterns with formatted datetime.
    Example: %time_format<%Y-%m-%d> becomes 2026-01-17
    """
    now = datetime.now()
    # Pattern to match %time_format<XXX> where XXX is any strftime format string
    # Use negative lookahead to exclude %time_format itself from variable delimiters
    pattern = r'%time_format<([^>]*)>'
    def replace_format(match):
        format_str = match.group(1)
        try:
            return now.strftime(format_str)
        except:
            # If format is invalid, return original
            return match.group(0)

    return re.sub(pattern, replace_format, filename)

def save_json(image_info: dict[str, Any] | None, filename: str) -> None:
    try:
        workflow = (image_info or {}).get('workflow')
        if workflow is None:
            print('No image info found, skipping saving of JSON')
        with open(f'{filename}.json', 'w') as workflow_file:
            json.dump(workflow, workflow_file)
            print(f'Saved workflow to {filename}.json')
    except Exception as e:
        print(f'Failed to save workflow as json due to: {e}, proceeding with the remainder of saving execution')

def make_pathname(filename: str, width: int, height: int, seed: int, modelname: str, counter: int, time_format: str, sampler_name: str, steps: int, cfg: float, scheduler_name: str, denoise: float, clip_skip: int, custom: str) -> str:
    # Process custom time_format patterns first
    filename = apply_custom_time_format(filename)
    filename = filename.replace("%date", get_timestamp("%Y-%m-%d"))
    filename = filename.replace("%time", get_timestamp(time_format))
    filename = filename.replace("%model", parse_checkpoint_name(modelname))
    filename = filename.replace("%width", str(width))
    filename = filename.replace("%height", str(height))
    filename = filename.replace("%seed", str(seed))
    filename = filename.replace("%counter", str(counter))
    filename = filename.replace("%sampler_name", sampler_name)
    filename = filename.replace("%steps", str(steps))
    filename = filename.replace("%cfg", str(cfg))
    filename = filename.replace("%scheduler_name", scheduler_name)
    filename = filename.replace("%basemodelname", parse_checkpoint_name_without_extension(modelname))
    filename = filename.replace("%denoise", str(denoise))
    filename = filename.replace("%clip_skip", str(clip_skip))
    filename = filename.replace("%custom", custom)

    directory, basename = os.path.split(filename)
    sanitized_basename = sanitize_filename(basename)
    return os.path.join(directory, sanitized_basename)

def make_filename(filename: str, width: int, height: int, seed: int, modelname: str, counter: int, time_format: str, sampler_name: str, steps: int, cfg: float, scheduler_name: str, denoise: float, clip_skip: int, custom: str) -> str:
    filename = make_pathname(filename, width, height, seed, modelname, counter, time_format, sampler_name, steps, cfg, scheduler_name, denoise, clip_skip, custom)
    return get_timestamp(time_format) if filename == "" else filename
