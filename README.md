# ComfyUI-Mottoes

A small pack of modern, **Vue-based** ComfyUI nodes with in-node editors — no
canvas-drawing gymnastics, just real DOM widgets that follow the active theme.

## Nodes

### Prompt Builder (Mottoes)
Compose a prompt from reorderable, toggleable sections with seeded wildcards
(`{a|b|c}` weighted choice, `[a|b|c]` sequential arrays, `__wildcard__` files).
Resolution runs in Python at execution time and also backs a live preview, so
what you preview is what you render. Supports pinning, locking, and history.

### Workflow Metadata Resolver (Mottoes)
A declaration node with a graph-aware picker: bind arbitrary workflow node
inputs to named metadata fields (searchable, reorderable, groupable, typed),
with a non-destructive auto-fill that traces the sampler and common fields.

### Multi Lora Loader (Mottoes)
Stack any number of LoRAs onto `MODEL`/`CLIP` in one node — per-row on/off
switch, searchable LoRA picker, strength field, inline reorder buttons + drag
handle, and a toggle-all header. Outputs `MODEL`, `CLIP`, and a structured
`LORA_INFO` (name, hash, weight, CivitAI metadata) directly. A modern
alternative to rgthree's Power Lora Loader.

### Group Muter (Mottoes) / Group Bypasser (Mottoes)
Mute or bypass whole workflow groups from a list of switches — one row per group
in the graph the node sits in, with a colour swatch, a jump-to-group button, a
title filter (plain text or `/regex/`), position or A→Z ordering, and an optional
"at most one" / "exactly one" restriction for switching between alternative
pipelines. The graph is the only state: the switches read the real node modes, so
muting a group with Ctrl+M or from a second toggle node shows up here too. Modern
alternatives to rgthree's Fast Groups Muter / Bypasser, which draw canvas widgets
the Vue renderer (Nodes 2.0) does not render.

## Install

Clone into your ComfyUI `custom_nodes` folder and restart ComfyUI:

```bash
cd ComfyUI/custom_nodes
git clone git@github.com:Trade-Mottoes/comfyui-mottoes.git
```

Dependencies (`requests`, `tqdm`) ship with ComfyUI; nothing extra to install.

## Development

```bash
python -m pytest tests/        # or: python -m unittest discover -s tests
```

The Python resolution/parse logic is dependency-free and unit-tested without a
running ComfyUI. The frontend vendors Vue (`js/lib/`) and compiles templates at
runtime — no build step.

## License

MIT (see [LICENSE](LICENSE)). The node implementations and their editors are
original work. Three helper modules under `services/` (`hashing.py`,
`civitai.py`, `file_utils.py`) are vendored from
[ComfyUI-Image-Saver](https://github.com/alexopus/ComfyUI-Image-Saver)
(MIT © 2023 Girish Gopaul) — see [NOTICE](NOTICE) for full attribution.
