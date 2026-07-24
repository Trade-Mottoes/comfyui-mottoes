"""Unit tests for the Power Lora Loader row parsing.

Run with either:
    python3 -m unittest tests.test_power_lora_loader   # stdlib, no install
    python3 -m pytest tests/test_multi_lora_loader.py    # if pytest is available

The row parser in ``nodes/multi_lora_loader.py`` has no ComfyUI dependency (the
loader/metadata imports are lazy inside ``load_loras``), so we load that file
directly and bypass the package ``__init__`` (which imports ComfyUI).
"""

import importlib.util
import json
import os
import unittest

_PATH = os.path.join(os.path.dirname(__file__), "..", "nodes", "multi_lora_loader.py")
_spec = importlib.util.spec_from_file_location("mottoes_multi_lora_loader", _PATH)
pll = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pll)


class CoerceRowsTest(unittest.TestCase):
    def test_parses_json_string(self):
        rows = pll.coerce_rows(json.dumps([
            {"on": True, "lora": "a.safetensors", "strength": 0.8},
            {"on": False, "lora": "sub/b.safetensors", "strength": 1.0, "strengthClip": 0.5},
        ]))
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["lora"], "a.safetensors")
        self.assertEqual(rows[1]["strengthClip"], 0.5)

    def test_accepts_already_parsed_list(self):
        rows = pll.coerce_rows([{"lora": "a.safetensors"}])
        self.assertEqual(len(rows), 1)

    def test_empty_and_blank_strings(self):
        self.assertEqual(pll.coerce_rows(""), [])
        self.assertEqual(pll.coerce_rows("   "), [])
        self.assertEqual(pll.coerce_rows("[]"), [])

    def test_invalid_json_is_empty(self):
        self.assertEqual(pll.coerce_rows("not json"), [])
        self.assertEqual(pll.coerce_rows("{not:json}"), [])

    def test_non_list_json_is_empty(self):
        self.assertEqual(pll.coerce_rows("{}"), [])
        self.assertEqual(pll.coerce_rows("42"), [])

    def test_drops_rows_without_a_lora(self):
        rows = pll.coerce_rows(json.dumps([
            {"on": True, "lora": "keep.safetensors", "strength": 1.0},
            {"on": True, "strength": 1.0},          # no lora key
            {"on": True, "lora": "", "strength": 1.0},  # empty lora
            "garbage",                               # not a dict
        ]))
        self.assertEqual([r["lora"] for r in rows], ["keep.safetensors"])

    def test_as_float_helper(self):
        self.assertEqual(pll._as_float("0.75", 1.0), 0.75)
        self.assertEqual(pll._as_float(None, 1.0), 1.0)
        self.assertEqual(pll._as_float("nan-ish", 0.5), 0.5)


if __name__ == "__main__":
    unittest.main()
