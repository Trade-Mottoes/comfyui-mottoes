"""Group Muter / Group Bypasser — mute or bypass whole workflow groups.

Two UI-only nodes that list every group in the graph they sit in and give each
one a switch: flipping it sets the mode of every node inside that group. The
muter uses ``NEVER`` (mute), the bypasser uses ComfyUI's bypass mode.

Native alternatives to rgthree's Fast Groups Muter / Bypasser, which are
frontend-only *virtual* nodes drawing canvas widgets — a widget style the Vue
renderer (Nodes 2.0) does not render, so they come up blank there. These are
registered like any other node and put a real DOM widget (js/groups/editor.js)
in the node body, so they work under both renderers.

There is nothing to do at execution time: group membership and node modes live
entirely in the frontend graph. The classes exist so the nodes appear in the
registry (search, node library, `/object_info`) with a proper definition. With
no outputs and no ``OUTPUT_NODE`` they are never part of an execution path, so
the backend prunes them from every prompt.
"""

from __future__ import annotations

from typing import Any


class _GroupModeToggle:
    """Shared definition for the two group-mode nodes (see module docstring)."""

    RETURN_TYPES: tuple[()] = ()
    FUNCTION = "noop"
    CATEGORY = "Mottoes"

    @classmethod
    def INPUT_TYPES(cls) -> dict[str, Any]:
        # No inputs: the node body is a DOM widget and its settings live in the
        # node's LiteGraph `properties`, so nothing needs to reach Python.
        return {"required": {}}

    def noop(self) -> tuple[()]:
        return ()


class GroupMuter(_GroupModeToggle):
    """Mute (ComfyUI 'Never') every node in a group, from a list of switches."""

    DESCRIPTION = "Mute or unmute whole workflow groups from a list of switches"


class GroupBypasser(_GroupModeToggle):
    """Bypass every node in a group, from a list of switches."""

    DESCRIPTION = "Bypass or re-enable whole workflow groups from a list of switches"
