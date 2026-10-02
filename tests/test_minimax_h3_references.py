"""Unit tests for MiniMax H3 Reference to Video (Mottoes).

The node is built from ComfyUI's own stock node, so these run only where ComfyUI imports —
on the render box, from the ComfyUI folder with its venv:

    cd /ai/comfy && .venv/bin/python -m unittest \
        custom_nodes/comfyui-mottoes/tests/test_minimax_h3_references.py
"""

import importlib.util
import os
import sys
import unittest

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

try:
    from comfy_api.latest import io
    from comfy_extras.nodes_minimax_h3 import MiniMaxH3ReferenceToVideo as Stock
except ImportError:                                    # not inside ComfyUI
    io = Stock = None

if io is not None:
    spec = importlib.util.spec_from_file_location(
        "mottoes_references_under_test", os.path.join(_ROOT, "nodes", "minimax_h3_references.py"))
    node = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = node
    spec.loader.exec_module(node)


def _autogrow(schema):
    return {i.id: i.template for i in schema.inputs if isinstance(i, io.Autogrow.Input)}


@unittest.skipIf(io is None, "ComfyUI is not importable here")
class ReferenceNodeTests(unittest.TestCase):
    def setUp(self):
        self.mine = node.MiniMaxH3ReferenceToVideoMany.GET_SCHEMA()
        self.stock = Stock.define_schema()

    def test_every_reference_container_is_widened(self):
        for container, template in _autogrow(self.mine).items():
            with self.subTest(container=container):
                self.assertEqual(template.max, node.LIMITS[container])
                self.assertEqual(len(template.names), node.LIMITS[container])

    def test_everything_else_is_the_stock_nodes(self):
        mine = [(i.id, type(i).__name__, i.optional) for i in self.mine.inputs]
        stock = [(i.id, type(i).__name__, i.optional) for i in self.stock.inputs]
        self.assertEqual(mine, stock)
        for container, template in _autogrow(self.stock).items():
            with self.subTest(container=container):
                widened = _autogrow(self.mine)[container]
                self.assertEqual((widened.prefix, widened.min), (template.prefix, template.min))
        self.assertEqual([o.io_type for o in self.mine.outputs],
                         [o.io_type for o in self.stock.outputs])

    def test_it_registers_under_its_node_id(self):
        self.assertEqual(self.mine.node_id, node.NODE_ID)
        with open(os.path.join(_ROOT, "__init__.py"), encoding="utf-8") as fh:
            self.assertIn(f'"{node.NODE_ID}": MiniMaxH3ReferenceToVideoMany', fh.read())

    def test_the_stock_node_is_left_alone(self):
        self.assertEqual(_autogrow(Stock.define_schema())["ref_videos"].max, 3)


if __name__ == "__main__":
    unittest.main()
