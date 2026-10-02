"""ComfyUI-Mottoes — modern, Vue-based ComfyUI nodes.

Node registration. See README.md for the node list and license/attribution notes.
"""

from typing import Any

from .nodes.prompt_builder import PromptBuilder
from .nodes.introspection import WorkflowMetadataResolver
from .nodes.multi_lora_loader import MultiLoraLoader
from .nodes.group_toggle import GroupMuter, GroupBypasser
from .nodes.minimax_h3 import MiniMaxH3Canvas
from .nodes.minimax_h3_references import MiniMaxH3ReferenceToVideoMany

# Display names double as the node type ids — the frontend (js/*.js) references
# these exact strings, so keep them in lock-step.
NODE_CLASS_MAPPINGS: dict[str, Any] = {
    "Prompt Builder (Mottoes)": PromptBuilder,
    "Workflow Metadata Resolver (Mottoes)": WorkflowMetadataResolver,
    "Multi Lora Loader (Mottoes)": MultiLoraLoader,
    "Group Muter (Mottoes)": GroupMuter,
    "Group Bypasser (Mottoes)": GroupBypasser,
    "MiniMax H3 Canvas (Mottoes)": MiniMaxH3Canvas,
    "MiniMax H3 Reference to Video (Mottoes)": MiniMaxH3ReferenceToVideoMany,
}

WEB_DIRECTORY = "js"

__all__ = ["NODE_CLASS_MAPPINGS", "WEB_DIRECTORY"]
