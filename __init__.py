"""ComfyUI-Mottoes — modern, Vue-based ComfyUI nodes.

Node registration. See README.md for the node list and license/attribution notes.
"""

from typing import Any

from .nodes.prompt_builder import PromptBuilder
from .nodes.introspection import WorkflowMetadataResolver
from .nodes.multi_lora_loader import MultiLoraLoader

# Display names double as the node type ids — the frontend (js/*.js) references
# these exact strings, so keep them in lock-step.
NODE_CLASS_MAPPINGS: dict[str, Any] = {
    "Prompt Builder (Mottoes)": PromptBuilder,
    "Workflow Metadata Resolver (Mottoes)": WorkflowMetadataResolver,
    "Multi Lora Loader (Mottoes)": MultiLoraLoader,
}

WEB_DIRECTORY = "js"

__all__ = ["NODE_CLASS_MAPPINGS", "WEB_DIRECTORY"]
