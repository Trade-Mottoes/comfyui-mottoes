from typing import Any

class AnyToString:
    """Converts any input type to a string. Useful for connecting sampler/scheduler outputs from various custom nodes."""

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("string",)
    OUTPUT_TOOLTIPS = ("String representation of the input",)
    FUNCTION = "convert"
    CATEGORY = "Mottoes"
    DESCRIPTION = "Converts any input type to string"

    @classmethod
    def INPUT_TYPES(cls) -> dict[str, Any]:
        return {
            "required": {
                "value": ("*",),
            }
        }

    @classmethod
    def VALIDATE_INPUTS(cls, input_types):
        return True

    def convert(self, value: Any) -> tuple[str,]:
        return (str(value),)


class WorkflowInputValue:
    """Extracts an input value from the workflow by node ID and input name."""

    RETURN_TYPES = ("*",)
    RETURN_NAMES = ("value",)
    OUTPUT_TOOLTIPS = ("Input value from the specified node",)
    FUNCTION = "get_input_value"
    CATEGORY = "Mottoes"
    DESCRIPTION = "Extract an input value from the workflow by node ID and input name"

    @classmethod
    def INPUT_TYPES(cls) -> dict[str, Any]:
        return {
            "required": {
                "node_id": ("STRING", {"default": "", "multiline": False, "tooltip": "The ID of the node to extract from"}),
                "input_name": ("STRING", {"default": "", "multiline": False, "tooltip": "The name of the input to extract"}),
            },
            "hidden": {
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO",
            },
        }

    def get_input_value(self, node_id: str, input_name: str, prompt: dict[str, Any] | None = None, extra_pnginfo: dict[str, Any] | None = None):
        if prompt is None:
            return (None,)

        # Verify the node exists in the workflow structure
        if extra_pnginfo and "workflow" in extra_pnginfo:
            workflow = extra_pnginfo["workflow"]
            node_exists = any(str(node.get("id")) == node_id for node in workflow.get("nodes", []))
            if not node_exists:
                print(f"WorkflowInputValue: Node {node_id} not found in workflow structure")
                return (None,)

        # Get the node from the prompt (execution values)
        node = prompt.get(node_id)
        if node is None:
            print(f"WorkflowInputValue: Node {node_id} not found in prompt")
            return (None,)

        # Get the inputs from the node
        inputs = node.get("inputs", {})
        if input_name not in inputs:
            print(f"WorkflowInputValue: Input '{input_name}' not found in node {node_id}")
            print(f"WorkflowInputValue: Available inputs: {list(inputs.keys())}")
            return (None,)

        value = inputs[input_name]
        return (value,)


# --- Multi-binding resolver ---------------------------------------------------
#
# Instead of wiring loaders/selectors through the graph to route values into the
# saver, declare a list of bindings — `field: #node.input` — and resolve them all
# from the live PROMPT at save time. The workflow JSON already holds every value;
# this just addresses into it. See WorkflowInputValue above for the single-field
# version this generalises.


def parse_bindings(text: str) -> tuple[list[tuple[str, str, str]], list[str]]:
    """Parse a binding spec into (field, node_id, input_name) tuples.

    The editor writes JSON (v2): `{"version": 2, "entries": [...]}` where each
    entry is a `field` ({key, node, input}) or a `group` header (ignored here).
    The legacy line format — `field: #node_id.input_name` (the `:` may be `=`,
    the `#` optional) — is still parsed so old workflows resolve unchanged.
    Returns (bindings, errors); malformed rows are skipped and reported.
    """
    if text and text.lstrip().startswith("{"):
        return _parse_bindings_json(text)

    bindings: list[tuple[str, str, str]] = []
    errors: list[str] = []

    for lineno, raw in enumerate(text.splitlines(), start=1):
        line = raw.strip()
        if not line or line.startswith("//"):
            continue
        # A leading '#' is a comment only when it isn't an inline field binding.
        if line.startswith("#") and not _has_separator(line):
            continue

        sep_idx = _separator_index(line)
        if sep_idx is None:
            errors.append(f"line {lineno}: missing ':' or '=' separator — '{raw}'")
            continue

        field = line[:sep_idx].strip()
        pointer = line[sep_idx + 1:].strip().lstrip("#").strip()
        node_id, dot, input_name = pointer.partition(".")
        node_id = node_id.strip()
        input_name = input_name.strip()

        if not field:
            errors.append(f"line {lineno}: empty field name — '{raw}'")
            continue
        if not pointer:
            continue  # an unbound row (`field:` with no target) — placeholder, not an error
        if not dot or not node_id or not input_name:
            errors.append(f"line {lineno}: pointer must be 'node_id.input_name' — '{raw}'")
            continue

        bindings.append((field, node_id, input_name))

    return bindings, errors


def _parse_bindings_json(text: str) -> tuple[list[tuple[str, str, str]], list[str]]:
    """Parse the JSON (v2) binding spec. Group headers and unbound rows are
    skipped silently; only fully-bound field entries become bindings."""
    import json

    bindings: list[tuple[str, str, str]] = []
    errors: list[str] = []
    try:
        obj = json.loads(text)
    except (ValueError, TypeError) as exc:
        return [], [f"invalid bindings JSON: {exc}"]

    entries = obj.get("entries") if isinstance(obj, dict) else None
    if not isinstance(entries, list):
        return [], ["bindings JSON missing an 'entries' list"]

    for entry in entries:
        if not isinstance(entry, dict) or entry.get("kind") == "group":
            continue
        field = str(entry.get("key", "")).strip()
        node_id = str(entry.get("node", "")).strip()
        input_name = str(entry.get("input", "")).strip()
        if not field or not node_id or not input_name:
            continue  # unbound / placeholder row — not an error
        bindings.append((field, node_id, input_name))

    return bindings, errors


def _has_separator(line: str) -> bool:
    return _separator_index(line) is not None


def _separator_index(line: str) -> int | None:
    """Index of the field/pointer separator — the earliest ':' or '='."""
    candidates = [line.index(c) for c in (":", "=") if c in line]
    return min(candidates) if candidates else None


def _is_link(value: Any) -> bool:
    """A ComfyUI link is `[node_id: str, output_slot: int]` — distinct from a
    literal list like `[width, height]` (both ints)."""
    return (
        isinstance(value, list)
        and len(value) == 2
        and isinstance(value[0], str)
        and isinstance(value[1], int)
    )


# Keys under which primitive/literal nodes carry their scalar value in the PROMPT.
_LITERAL_KEYS = ("value", "int", "float", "string", "text", "boolean", "number")


def _follow_link(prompt: dict[str, Any], value: Any, depth: int = 0) -> Any:
    """Resolve a value to a literal, following links through the PROMPT graph.

    A direct literal returns as-is. A link is followed to its source node; if that
    node is a primitive carrying a scalar (or a text node carrying `text`), that
    value is returned (recursively). Non-scalar outputs resolve to None.
    """
    if not _is_link(value):
        return value
    if depth > 16:
        return None  # cycle or pathologically deep chain — cannot resolve to a literal

    source = prompt.get(value[0])
    if not isinstance(source, dict):
        return None

    inputs = source.get("inputs", {})
    for key in _LITERAL_KEYS:
        if key in inputs:
            return _follow_link(prompt, inputs[key], depth + 1)
    return None


def resolve_bindings(
    bindings: list[tuple[str, str, str]],
    prompt: dict[str, Any],
    workflow: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], list[str]]:
    """Resolve parsed bindings against the PROMPT. Returns (resolved, errors).

    `workflow` (the UI graph from EXTRA_PNGINFO) is used only to give a clearer
    error when a node id is absent from the graph entirely.
    """
    resolved: dict[str, Any] = {}
    errors: list[str] = []

    workflow_ids: set[str] | None = None
    if isinstance(workflow, dict) and isinstance(workflow.get("nodes"), list):
        workflow_ids = {str(n.get("id")) for n in workflow["nodes"] if isinstance(n, dict)}

    for field, node_id, input_name in bindings:
        node = prompt.get(node_id)
        if node is None:
            where = "workflow" if workflow_ids is not None and node_id not in workflow_ids else "prompt"
            errors.append(f"{field}: node #{node_id} not found in {where}")
            continue

        inputs = node.get("inputs", {})
        if input_name not in inputs:
            available = ", ".join(inputs.keys()) or "(none)"
            errors.append(f"{field}: input '{input_name}' not on node #{node_id} — available: {available}")
            continue

        resolved[field] = _follow_link(prompt, inputs[input_name])

    return resolved, errors


class WorkflowMetadataResolver:
    """Declare where each metadata field lives in the workflow.

    A wiring-free, pure-declaration node: each binding (`field: #node.input`)
    records where a value lives in the graph. The node has no outputs and needs
    no wiring — it is OUTPUT_NODE only so it stays in the executed prompt, which
    embeds the bindings into saved images. Downstream consumers (e.g. the gallery)
    read the bindings back from the embedded prompt and resolve them there.
    """

    OUTPUT_NODE = True
    RETURN_TYPES = ()
    FUNCTION = "resolve"
    CATEGORY = "Mottoes"
    DESCRIPTION = "Declare where metadata fields live in the workflow (resolved downstream, e.g. by the gallery)"

    @classmethod
    def IS_CHANGED(cls, **kwargs) -> float:
        # Always re-run so the server-side binding validation reflects the live graph.
        return float("nan")

    @classmethod
    def INPUT_TYPES(cls) -> dict[str, Any]:
        # `bindings` is optional (not required) so that, even if the front-end
        # component editor fails to supply it, the node never blocks a queue — it
        # just declares nothing. The editor (js/metadata_resolver_picker.js)
        # replaces the auto-created text widget with a row editor that serializes
        # the same `bindings` string into the prompt.
        return {
            "optional": {
                "bindings": ("STRING", {
                    "default": "positive:\nnegative:\nmodel:\nsampler:\nscheduler:\n"
                               "steps:\ncfg:\nseed:\nwidth:\nheight:",
                    "multiline": True,
                    "tooltip": "Each row binds a metadata field to a workflow value: `field: #node_id.input`.\n"
                               "Use the component rows (right-click a node -> Send to Metadata Resolver,\n"
                               "or Auto-fill). A row left with no target is unbound and ignored.",
                }),
            },
            "hidden": {
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO",
            },
        }

    def resolve(
        self,
        bindings: str = "",
        prompt: dict[str, Any] | None = None,
        extra_pnginfo: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        # Pure declaration: no outputs, nothing wired in. OUTPUT_NODE keeps the
        # node in the executed prompt so its bindings are embedded in saved
        # images; the values are read back and resolved downstream (e.g. the
        # gallery). We resolve here only to surface binding problems in the log.
        parsed, parse_errors = parse_bindings(bindings)
        for err in parse_errors:
            print(f"WorkflowMetadataResolver: {err}")
        if prompt:
            workflow = extra_pnginfo.get("workflow") if isinstance(extra_pnginfo, dict) else None
            _, resolve_errors = resolve_bindings(parsed, prompt, workflow)
            for err in resolve_errors:
                print(f"WorkflowMetadataResolver: {err}")
        return {}
