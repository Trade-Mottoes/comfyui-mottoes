"""Prompt Builder — seeded, lockable wildcard prompt composition.

The resolution engine here is the single source of truth: it runs at node
execution time *and* backs the editor's live preview (via the
``/mottoes/prompt/build`` route below), so preview and run always agree. The frontend
only tokenizes for syntax highlighting; it never resolves.

Everything above the node class is pure Python with no ComfyUI dependency, so
``tests/test_prompt_builder.py`` can load this file directly and exercise the
grammar without a running ComfyUI (mirroring ``tests/test_resolver.py``).

Grammar (resolved at build time):
    {a|b|c}     weighted random choice, pick one   (weights: {3::a|2::b|c})
    [a|b|c]     array, sequential by index
    __name__    wildcard file/list, pick like {…}
    %name%      choice variable — a curated label→value picked in the editor;
                one value per build, reused across every reference

Tokens nest ({red|{light|dark} blue}); the chosen branch is re-resolved.
Each token is salted by (section, raw text, occurrence) so identical tokens
roll independently yet stably for a given seed.
"""

from __future__ import annotations

import json
import re
import zlib
from random import Random
from typing import Any

# --------------------------------------------------------------------------- #
# Grammar primitives
# --------------------------------------------------------------------------- #

_WILDCARD_RE = re.compile(r"__([A-Za-z0-9_./-]+)__")
_WEIGHT_RE = re.compile(r"^\s*(\d+(?:\.\d+)?)::(.*)$", re.DOTALL)
_CHOICE_RE = re.compile(r"%([A-Za-z0-9_]+)%")
_OPENERS = "{["
_CLOSERS = "}]"
_MATCH = {"}": "{", "]": "["}


def _crc(s: str) -> int:
    """Deterministic non-negative hash (unlike the PYTHONHASHSEED-salted hash())."""
    return zlib.crc32(s.encode("utf-8"))


def _rng(seed: int, salt: str) -> Random:
    """An independent, reproducible stream per token.

    Random() seeded with a str is deterministic across processes (it does not
    use the salted builtin hash), so ``(seed, salt)`` fully determines the roll.
    """
    return Random(f"{seed}:{salt}")


def _find_span(text: str, i: int) -> int:
    """Index of the closer matching the opener at ``text[i]``, or -1 if unbalanced."""
    stack = [text[i]]
    j = i + 1
    n = len(text)
    while j < n:
        c = text[j]
        if c in _OPENERS:
            stack.append(c)
        elif c in _CLOSERS:
            if stack and stack[-1] == _MATCH[c]:
                stack.pop()
                if not stack:
                    return j
            else:
                return -1  # mismatched closer
        j += 1
    return -1  # never closed


def _split_top_level(content: str) -> list[str]:
    """Split on ``|`` at bracket-depth 0, so nested tokens stay intact."""
    parts: list[str] = []
    depth = 0
    cur: list[str] = []
    for c in content:
        if c in _OPENERS:
            depth += 1
            cur.append(c)
        elif c in _CLOSERS:
            depth -= 1
            cur.append(c)
        elif c == "|" and depth == 0:
            parts.append("".join(cur))
            cur = []
        else:
            cur.append(c)
    parts.append("".join(cur))
    return parts


def _parse_weight(option: str) -> tuple[float, str]:
    """``3::red`` -> (3.0, 'red'); bare option -> (1.0, option). Text kept verbatim."""
    m = _WEIGHT_RE.match(option)
    if m:
        try:
            return float(m.group(1)), m.group(2)
        except ValueError:
            pass
    return 1.0, option


def _weighted_pick(options: list[str], seed: int, key: str) -> str:
    """Weighted random choice over options; weight-0 options never win."""
    parsed = [_parse_weight(o) for o in options]
    total = sum(w for w, _ in parsed if w > 0)
    if total <= 0:
        return parsed[0][1] if parsed else ""
    roll = _rng(seed, key).random() * total
    for w, text in parsed:
        if w <= 0:
            continue
        roll -= w
        if roll < 0:
            return text
    return parsed[-1][1]


def _sequential_index(n: int, seed: int, key: str, counters: dict[str, int]) -> int:
    """Sequential position for an ``[a|b|c]`` token.

    Build mode threads an explicit per-token counter; at run time the seed *is*
    the counter (control_after_generate=increment rotates one step per queue).
    A stable per-token offset phase-shifts each array so they don't lock-step.
    """
    if n <= 0:
        return 0
    if key in counters:
        return counters[key] % n
    return (seed + _crc(key)) % n


# --------------------------------------------------------------------------- #
# Resolution
# --------------------------------------------------------------------------- #


def _roll(key, kind, raw, chosen, source="roll", index=None):
    r = {"key": key, "type": kind, "raw": raw, "chosen": chosen, "source": source}
    if index is not None:
        r["index"] = index
    return r


def _next_key(ctx: dict, section_id: str, raw: str) -> str:
    """A stable key per (section, token text, occurrence).

    Editing the token text changes the key, so any pin on it self-heals away.
    """
    base = f"{section_id}|{raw}"
    occ = ctx["occ"].get(base, 0)
    ctx["occ"][base] = occ + 1
    return f"{base}|{occ}"


def _resolve_template(text: str, ctx: dict, section_id: str) -> tuple[str, list]:
    out: list[str] = []
    rolls: list = []
    i = 0
    n = len(text)
    while i < n:
        c = text[i]
        if c in _OPENERS:
            end = _find_span(text, i)
            if end == -1:
                out.append(c)
                i += 1
                continue
            raw = text[i : end + 1]
            inner = text[i + 1 : end]
            kind = "choice" if c == "{" else "array"
            chosen, sub = _resolve_bracket(kind, raw, inner, ctx, section_id)
            out.append(chosen)
            rolls.extend(sub)
            i = end + 1
        elif c == "_" and text.startswith("__", i):
            m = _WILDCARD_RE.match(text, i)
            if m:
                chosen, sub = _resolve_wildcard(m.group(1), m.group(0), ctx, section_id)
                out.append(chosen)
                rolls.extend(sub)
                i = m.end()
            else:
                out.append(c)
                i += 1
        elif c == "%":
            m = _CHOICE_RE.match(text, i)
            if m:
                chosen, sub = _resolve_choice(m.group(1), m.group(0), ctx, section_id)
                out.append(chosen)
                rolls.extend(sub)
                i = m.end()
            else:
                out.append(c)
                i += 1
        else:
            out.append(c)
            i += 1
    return "".join(out), rolls


def _resolve_pinned(key, kind, raw, ctx, section_id):
    value = ctx["pins"][key]
    resolved, sub = _resolve_template(value, ctx, section_id)
    return resolved, [_roll(key, kind, raw, resolved, source="pin")] + sub


def _resolve_bracket(kind, raw, inner, ctx, section_id):
    key = _next_key(ctx, section_id, raw)
    if key in ctx["pins"]:
        return _resolve_pinned(key, kind, raw, ctx, section_id)
    options = _split_top_level(inner)
    index = None
    if kind == "choice":
        chosen_raw = _weighted_pick(options, ctx["seed"], key)
    else:
        index = _sequential_index(len(options), ctx["seed"], key, ctx["counters"])
        chosen_raw = options[index] if options else ""
    resolved, sub = _resolve_template(chosen_raw, ctx, section_id)
    return resolved, [_roll(key, kind, raw, resolved, index=index)] + sub


def _resolve_wildcard(name, raw, ctx, section_id):
    key = _next_key(ctx, section_id, raw)
    if key in ctx["pins"]:
        return _resolve_pinned(key, "wildcard", raw, ctx, section_id)
    options = ctx["wildcards"].get(name)
    if not options:
        ctx["warnings"].append(f"unknown wildcard __{name}__")
        return raw, [_roll(key, "wildcard", raw, raw, source="missing")]
    chosen_raw = _weighted_pick(list(options), ctx["seed"], key)
    resolved, sub = _resolve_template(chosen_raw, ctx, section_id)
    return resolved, [_roll(key, "wildcard", raw, resolved)] + sub


def _choice_value(cdef: dict, ctx: dict) -> str:
    """The value a choice injects, by mode:

    - ``single`` — the selected option's value (falling back to the first).
    - ``multi``  — every selected option's value, in options order, joined by
      ``cdef["join"]`` (default ``", "``); empty values dropped.
    - ``random`` — one option's value, picked seeded by ``(seed, name)`` so it is
      stable within a build and rerolls with the seed.

    Empty when the choice has no options.
    """
    options = cdef.get("options") or []
    if not options:
        return ""
    mode = cdef.get("mode", "single")
    if mode == "random":
        opt = _rng(ctx["seed"], f"choice:{cdef.get('name', '')}").choice(options)
        return opt.get("value", "") or ""
    selected = cdef.get("selected")
    if isinstance(selected, str):        # back-compat: single-select once stored a bare id
        selected = [selected]
    elif not isinstance(selected, list):
        selected = []
    if mode == "multi":
        sel = set(selected)
        vals = [o.get("value", "") or "" for o in options if o.get("id") in sel]
        return (cdef.get("join") or ", ").join(v for v in vals if v)
    for o in options:                    # single
        if o.get("id") in selected:
            return o.get("value", "") or ""
    return options[0].get("value", "") or ""


def _resolve_choice(name: str, raw: str, ctx: dict, section_id: str):
    """Resolve a ``%name%`` choice variable.

    Variable semantics: the value is computed once per build and reused for every
    reference (unlike ``{…}``, which rolls independently per occurrence). The
    injected value is itself re-resolved, so a choice value can contain nested
    tokens. An undefined name is left verbatim with a warning.
    """
    cdef = ctx["choices"].get(name)
    if cdef is None:
        ctx["warnings"].append(f"unknown choice %{name}%")
        return raw, [_roll(f"%{name}%", "var", raw, raw, source="missing")]
    if name in ctx["choice_cache"]:
        return ctx["choice_cache"][name], []
    resolved, sub = _resolve_template(_choice_value(cdef, ctx), ctx, section_id)
    ctx["choice_cache"][name] = resolved
    return resolved, [_roll(f"%{name}%", "var", raw, resolved, source="choice")] + sub


def _coerce_state(state: Any) -> dict:
    if isinstance(state, dict):
        return state
    s = (state or "").strip() if isinstance(state, str) else ""
    if not s:
        return {}
    try:
        obj = json.loads(s)
    except (ValueError, TypeError):
        return {}
    return obj if isinstance(obj, dict) else {}


def resolve_prompt(state: Any, seed: int, wildcards: dict | None = None, now: int = 0) -> dict:
    """Resolve the full node state into a BuildRecord (see PROMPT_NODE_SPEC §6)."""
    st = _coerce_state(state)
    settings = st.get("settings") or {}
    joiner = settings.get("joiner", ", ")
    ctx = {
        "seed": int(seed),
        "pins": st.get("pins") or {},
        "counters": st.get("counters") or {},
        "wildcards": wildcards or {},
        "choices": {c["name"]: c for c in (st.get("choices") or []) if isinstance(c, dict) and c.get("name")},
        "choice_cache": {},
        "occ": {},
        "warnings": [],
    }
    sec_records: list = []
    all_rolls: list = []
    parts: list[str] = []
    for s in st.get("sections") or []:
        sid = s.get("id") or ""
        title = s.get("title", "")
        if not s.get("enabled", True):
            sec_records.append({"id": sid, "title": title, "enabled": False, "resolved": ""})
            continue
        resolved, rolls = _resolve_template(s.get("content", "") or "", ctx, sid)
        sec_records.append({"id": sid, "title": title, "enabled": True, "resolved": resolved})
        all_rolls.extend(rolls)
        if resolved.strip():
            parts.append(resolved)
    return {
        "builtAt": now,
        "seed": int(seed),
        "mode": settings.get("mode", "reroll"),
        "sections": sec_records,
        "rolls": all_rolls,
        "output": joiner.join(parts),
        "warnings": ctx["warnings"],
    }


# --------------------------------------------------------------------------- #
# ComfyUI node
# --------------------------------------------------------------------------- #

_DEFAULT_STATE = json.dumps(
    {
        "version": 1,
        "settings": {"mode": "reroll", "joiner": ", "},
        "sections": [
            {"id": "s1", "title": "", "enabled": True, "collapsed": False, "content": ""}
        ],
        "pins": {},
        "counters": {},
        "choices": [],
        "cache": None,
        "history": [],
    }
)


def _now_ms() -> int:
    import time

    return int(time.time() * 1000)


def _load_wildcards() -> dict[str, list[str]]:
    """Load ``name -> [lines]`` from wildcard .txt files, if any are present.

    Looks in ComfyUI's ``models/wildcards`` (when folder_paths is importable)
    and a repo-local ``wildcards/`` dir. Missing sources degrade to ``{}``.
    """
    import os

    dirs: list[str] = []
    try:
        import folder_paths  # type: ignore

        dirs.append(os.path.join(folder_paths.models_dir, "wildcards"))
    except Exception:
        pass
    dirs.append(os.path.join(os.path.dirname(__file__), "..", "wildcards"))

    out: dict[str, list[str]] = {}
    for d in dirs:
        if not os.path.isdir(d):
            continue
        for root, _, files in os.walk(d):
            for fn in files:
                if not fn.lower().endswith(".txt"):
                    continue
                name = os.path.splitext(fn)[0]
                try:
                    with open(os.path.join(root, fn), encoding="utf-8") as fh:
                        lines = [ln.strip() for ln in fh]
                except OSError:
                    continue
                out[name] = [ln for ln in lines if ln and not ln.startswith("#")]
    return out


class PromptBuilder:
    """Compose a prompt from reorderable sections with seeded wildcards."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xFFFFFFFFFFFFFFFF}),
                "state": ("STRING", {"multiline": True, "default": _DEFAULT_STATE}),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("prompt",)
    FUNCTION = "build"
    CATEGORY = "Mottoes"

    def build(self, seed, state):
        st = _coerce_state(state)
        if (st.get("settings") or {}).get("mode") == "locked":
            return ((st.get("cache") or {}).get("output", ""),)
        record = resolve_prompt(st, seed, wildcards=_load_wildcards(), now=_now_ms())
        return (record["output"],)

    @classmethod
    def IS_CHANGED(cls, seed, state):
        import hashlib

        st = _coerce_state(state)
        if (st.get("settings") or {}).get("mode") == "locked":
            return (st.get("cache") or {}).get("output", "")
        digest = hashlib.sha256((state or "").encode("utf-8")).hexdigest()
        return f"{seed}:{digest}"


# --------------------------------------------------------------------------- #
# Live-preview route (registered only when running inside ComfyUI)
# --------------------------------------------------------------------------- #

try:  # pragma: no cover - exercised only under a live ComfyUI server
    from aiohttp import web
    from server import PromptServer

    @PromptServer.instance.routes.post("/mottoes/prompt/build")
    async def _prompt_build_route(request):
        data = await request.json()
        record = resolve_prompt(
            data.get("state", {}),
            int(data.get("seed", 0)),
            wildcards=_load_wildcards(),
            now=_now_ms(),
        )
        return web.json_response(record)
except Exception:
    pass
