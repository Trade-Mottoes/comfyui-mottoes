"""Unit tests for the multi-binding workflow metadata resolver.

Run with either:
    python3 -m unittest tests.test_resolver        # stdlib, no install
    python3 -m pytest tests/test_resolver.py        # if pytest is available

The resolution helpers in ``nodes/introspection.py`` have no ComfyUI
dependencies, so we load that file directly and bypass the package
``__init__`` (which imports ``folder_paths``).
"""

import importlib.util
import json
import os
import unittest

_PATH = os.path.join(os.path.dirname(__file__), "..", "nodes", "introspection.py")
_spec = importlib.util.spec_from_file_location("imagesaver_introspection", _PATH)
introspection = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(introspection)

parse_bindings = introspection.parse_bindings
resolve_bindings = introspection.resolve_bindings
_is_link = introspection._is_link
_follow_link = introspection._follow_link


# A representative PROMPT (ComfyUI API format): node ids -> {class_type, inputs}.
PROMPT = {
    "3": {"class_type": "KSampler", "inputs": {
        "seed": 12345, "steps": 30, "cfg": 7.5,
        "sampler_name": "euler", "scheduler": "normal", "denoise": 1.0,
        "positive": ["6", 0], "negative": ["7", 0],
        "latent_image": ["5", 0], "model": ["4", 0],
    }},
    "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "sdxl.safetensors"}},
    "5": {"class_type": "EmptyLatentImage", "inputs": {"width": 832, "height": 1216, "batch_size": 1}},
    "6": {"class_type": "CLIPTextEncode", "inputs": {"text": "a cat", "clip": ["4", 1]}},
    "7": {"class_type": "CLIPTextEncode", "inputs": {"text": "blurry", "clip": ["4", 1]}},
    # 'steps' converted to an input, fed from a primitive node:
    "8": {"class_type": "KSampler", "inputs": {"steps": ["9", 0], "seed": 1}},
    "9": {"class_type": "PrimitiveNode", "inputs": {"value": 42}},
    # an input that is genuinely a literal list, not a link:
    "10": {"class_type": "Foo", "inputs": {"size": [832, 1216]}},
}

WORKFLOW = {"nodes": [{"id": int(nid)} for nid in PROMPT]}


def resolve(text, prompt=PROMPT, workflow=WORKFLOW):
    bindings, parse_errors = parse_bindings(text)
    resolved, resolve_errors = resolve_bindings(bindings, prompt, workflow)
    return resolved, parse_errors + resolve_errors


class ParseBindingsTests(unittest.TestCase):
    def test_colon_and_equals_separators(self):
        bindings, errors = parse_bindings("positive: #6.text\nsteps = #3.steps")
        self.assertEqual(errors, [])
        self.assertEqual(bindings, [("positive", "6", "text"), ("steps", "3", "steps")])

    def test_hash_prefix_is_optional(self):
        bindings, errors = parse_bindings("steps: 3.steps")
        self.assertEqual(bindings, [("steps", "3", "steps")])
        self.assertEqual(errors, [])

    def test_comments_and_blank_lines_ignored(self):
        text = "// a comment\n\n# also a comment\nsteps: #3.steps\n"
        bindings, errors = parse_bindings(text)
        self.assertEqual(bindings, [("steps", "3", "steps")])
        self.assertEqual(errors, [])

    def test_inline_hash_field_is_not_treated_as_comment(self):
        # First token is '#field' but it carries a separator, so it's a binding.
        bindings, errors = parse_bindings("#weird: #3.steps")
        self.assertEqual(bindings, [("#weird", "3", "steps")])
        self.assertEqual(errors, [])

    def test_malformed_lines_reported_and_skipped(self):
        text = "no_separator_here\n: 3.steps\ngood: #3.cfg"
        bindings, errors = parse_bindings(text)
        self.assertEqual(bindings, [("good", "3", "cfg")])
        self.assertEqual(len(errors), 2)

    def test_unbound_rows_skipped_silently(self):
        # A labelled row with no target (`field:`) is an unbound placeholder,
        # not an error — the component editor round-trips these.
        text = "positive:\nsteps: #3.steps\nmodel =\nseed:#3.seed"
        bindings, errors = parse_bindings(text)
        self.assertEqual(bindings, [("steps", "3", "steps"), ("seed", "3", "seed")])
        self.assertEqual(errors, [])


class ParseBindingsJsonTests(unittest.TestCase):
    """The editor writes JSON (v2); parse_bindings must read it as well as legacy."""

    def test_json_v2_fields_and_groups(self):
        text = json.dumps({"version": 2, "entries": [
            {"kind": "field", "key": "positive", "node": "6", "input": "text", "type": "prompt"},
            {"kind": "group", "title": "Sampling"},
            {"kind": "field", "key": "steps", "node": "3", "input": "steps", "type": "int"},
        ]})
        bindings, errors = parse_bindings(text)
        self.assertEqual(bindings, [("positive", "6", "text"), ("steps", "3", "steps")])
        self.assertEqual(errors, [])

    def test_json_unbound_entries_skipped(self):
        text = json.dumps({"version": 2, "entries": [
            {"kind": "field", "key": "cfg"},                       # no target
            {"kind": "field", "key": "steps", "node": "3", "input": "steps"},
        ]})
        bindings, errors = parse_bindings(text)
        self.assertEqual(bindings, [("steps", "3", "steps")])
        self.assertEqual(errors, [])

    def test_json_leading_whitespace_still_detected(self):
        bindings, errors = parse_bindings(
            '\n  {"version":2,"entries":[{"kind":"field","key":"seed","node":"3","input":"seed"}]}')
        self.assertEqual(bindings, [("seed", "3", "seed")])
        self.assertEqual(errors, [])

    def test_malformed_json_reports_error(self):
        bindings, errors = parse_bindings("{not valid json")
        self.assertEqual(bindings, [])
        self.assertEqual(len(errors), 1)
        self.assertIn("invalid bindings JSON", errors[0])


class IsLinkTests(unittest.TestCase):
    def test_link_shape(self):
        self.assertTrue(_is_link(["3", 0]))
        self.assertTrue(_is_link(["9", 1]))

    def test_literal_list_is_not_a_link(self):
        self.assertFalse(_is_link([832, 1216]))  # [int, int]
        self.assertFalse(_is_link(["a", "b"]))    # [str, str]
        self.assertFalse(_is_link(["3", 0, 1]))   # wrong arity
        self.assertFalse(_is_link("euler"))
        self.assertFalse(_is_link(30))


class ResolveBindingsTests(unittest.TestCase):
    def test_direct_literals(self):
        resolved, errors = resolve("steps: #3.steps\ncfg: #3.cfg\nsampler: #3.sampler_name")
        self.assertEqual(errors, [])
        self.assertEqual(resolved, {"steps": 30, "cfg": 7.5, "sampler": "euler"})

    def test_text_node_direct(self):
        resolved, errors = resolve("positive: #6.text")
        self.assertEqual(resolved, {"positive": "a cat"})
        self.assertEqual(errors, [])

    def test_follows_link_from_sampler_to_text_node(self):
        # Pointing at the KSampler's 'positive' link resolves through to the text.
        resolved, errors = resolve("positive: #3.positive\nnegative: #3.negative")
        self.assertEqual(resolved, {"positive": "a cat", "negative": "blurry"})
        self.assertEqual(errors, [])

    def test_follows_converted_widget_primitive(self):
        resolved, errors = resolve("steps: #8.steps")
        self.assertEqual(resolved, {"steps": 42})
        self.assertEqual(errors, [])

    def test_literal_list_value_preserved(self):
        resolved, errors = resolve("size: #10.size")
        self.assertEqual(resolved, {"size": [832, 1216]})
        self.assertEqual(errors, [])

    def test_unresolvable_model_link_is_none(self):
        # The checkpoint loader output has no scalar value key -> None.
        resolved, errors = resolve("model: #3.model")
        self.assertEqual(resolved, {"model": None})
        self.assertEqual(errors, [])

    def test_missing_node_reports_error(self):
        resolved, errors = resolve("steps: #999.steps")
        self.assertEqual(resolved, {})
        self.assertEqual(len(errors), 1)
        self.assertIn("#999", errors[0])

    def test_missing_input_reports_available(self):
        resolved, errors = resolve("foo: #3.does_not_exist")
        self.assertEqual(resolved, {})
        self.assertEqual(len(errors), 1)
        self.assertIn("available", errors[0])

    def test_node_absent_from_workflow_named_in_error(self):
        prompt = {k: v for k, v in PROMPT.items() if k != "6"}
        workflow = {"nodes": [{"id": int(nid)} for nid in prompt]}
        bindings, _ = parse_bindings("positive: #6.text")
        _, errors = resolve_bindings(bindings, prompt, workflow)
        self.assertEqual(len(errors), 1)
        self.assertIn("workflow", errors[0])


class FollowLinkTests(unittest.TestCase):
    def test_passthrough_literal(self):
        self.assertEqual(_follow_link(PROMPT, 30), 30)
        self.assertEqual(_follow_link(PROMPT, "euler"), "euler")

    def test_recursion_guard(self):
        # A self-referential link must terminate rather than recurse forever.
        loop = {"1": {"inputs": {"value": ["1", 0]}}}
        self.assertIsNone(_follow_link(loop, ["1", 0]))


if __name__ == "__main__":
    unittest.main()
