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
in the graph the node sits in, with a colour swatch and a jump-to-group button.
Each node keeps its own subset: ✕ drops a group from the list (bound by group id,
so renaming is fine) and the settings panel puts it back, so a busy workflow can
have one node for the three groups you actually toggle. Also a title filter
(plain text or `/regex/`), position or A→Z ordering, and an optional "at most
one" / "exactly one" restriction for switching between alternative pipelines. The
graph is the only state: the switches read the real node modes, so muting a group
with Ctrl+M or from a second toggle node shows up here too. Modern alternatives
to rgthree's Fast Groups Muter / Bypasser, which draw canvas widgets the Vue
renderer (Nodes 2.0) does not render.

## Commands

Two frontend-only extras, no node involved. Both appear in the command palette
and under Settings → Keybindings:

- **Toggle link visibility (hide / show)** — flip every link in the graph between
  hidden and the last visible render mode.
- **Toggle Bookmarks panel** — open the Bookmarks sidebar, which jumps the canvas
  to a workflow group. Bookmarks bind to a group's stable id (renaming is fine),
  travel with the workflow, and take their own per-bookmark hotkeys assigned
  inside the panel.

Neither ships a **default hotkey**, deliberately. When two extensions declare the
same default combo, ComfyUI throws `Keybinding on <combo> already exists on
<command>` on every load and drops one of them — and that error can't be cleared
from the settings UI, because the check runs against the defaults map that
Settings never writes to. So pick your own combos in Settings → Keybindings; one
already claimed by another pack is fair game there (it prompts to overwrite),
since a user keybinding sits outside the defaults map entirely.

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
