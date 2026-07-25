"""Unit tests for the Prompt Builder resolution engine.

Run with either:
    python3 -m unittest tests.test_prompt_builder     # stdlib, no install
    python3 -m pytest tests/test_prompt_builder.py      # if pytest is available

The engine in ``nodes/prompt_builder.py`` has no ComfyUI dependency, so we load
that file directly and bypass the package ``__init__`` (which imports ComfyUI).
"""

import importlib.util
import os
import unittest

_PATH = os.path.join(os.path.dirname(__file__), "..", "nodes", "prompt_builder.py")
_spec = importlib.util.spec_from_file_location("imagesaver_prompt_builder", _PATH)
pb = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pb)


def state(sections, **kw):
    """Build a node-state dict from a list of (title, content) or content strings."""
    secs = []
    for i, s in enumerate(sections):
        title, content = ("s%d" % i, s) if isinstance(s, str) else s
        secs.append(
            {"id": "s%d" % i, "title": title, "enabled": True, "collapsed": False, "content": content}
        )
    return {
        "version": 1,
        "settings": {"mode": kw.get("mode", "reroll"), "joiner": kw.get("joiner", ", ")},
        "sections": secs,
        "pins": kw.get("pins", {}),
        "counters": kw.get("counters", {}),
        "choices": kw.get("choices", []),
    }


def out(sections, seed=0, wildcards=None, **kw):
    return pb.resolve_prompt(state(sections, **kw), seed, wildcards=wildcards)["output"]


class SpanAndSplitTests(unittest.TestCase):
    def test_find_span_simple(self):
        self.assertEqual(pb._find_span("{a|b}", 0), 4)

    def test_find_span_nested(self):
        self.assertEqual(pb._find_span("{a|{b|c}}", 0), 8)

    def test_find_span_interleaved(self):
        self.assertEqual(pb._find_span("{a|[b|c]}", 0), 8)

    def test_find_span_unbalanced(self):
        self.assertEqual(pb._find_span("{a|b", 0), -1)

    def test_split_respects_nesting(self):
        self.assertEqual(pb._split_top_level("a|{b|c}|d"), ["a", "{b|c}", "d"])

    def test_parse_weight(self):
        self.assertEqual(pb._parse_weight("3::red"), (3.0, "red"))
        self.assertEqual(pb._parse_weight("plain"), (1.0, "plain"))
        self.assertEqual(pb._parse_weight("2.5::x"), (2.5, "x"))


class PlainTextTests(unittest.TestCase):
    def test_passthrough(self):
        self.assertEqual(out(["a cat, sitting"]), "a cat, sitting")

    def test_sections_joined(self):
        self.assertEqual(out(["a cat", "on a mat"]), "a cat, on a mat")

    def test_custom_joiner(self):
        self.assertEqual(out(["a", "b"], joiner=" BREAK "), "a BREAK b")

    def test_disabled_section_skipped(self):
        st = state(["a cat", "unwanted"])
        st["sections"][1]["enabled"] = False
        self.assertEqual(pb.resolve_prompt(st, 0)["output"], "a cat")

    def test_empty_section_dropped_from_join(self):
        self.assertEqual(out(["a", "", "b"]), "a, b")


class ChoiceTests(unittest.TestCase):
    def test_choice_membership(self):
        for seed in range(20):
            self.assertIn(out(["{red|green|blue}"], seed=seed), {"red", "green", "blue"})

    def test_choice_deterministic_for_seed(self):
        self.assertEqual(out(["{red|green|blue}"], seed=7), out(["{red|green|blue}"], seed=7))

    def test_zero_weight_never_chosen(self):
        # weight 0 excluded -> only 'a' can win, for every seed.
        for seed in range(30):
            self.assertEqual(out(["{1::a|0::b}"], seed=seed), "a")

    def test_weight_forces_single(self):
        for seed in range(30):
            self.assertEqual(out(["{x {1::a|0::b}}"], seed=seed), "x a")

    def test_independent_tokens_can_differ(self):
        # Two identical tokens are salted by occurrence, so they roll independently.
        results = {out(["{a|b|c|d} {a|b|c|d}"], seed=s) for s in range(20)}
        self.assertTrue(any(l.split()[0] != l.split()[1] for l in results))


class ArrayTests(unittest.TestCase):
    def test_array_membership(self):
        self.assertIn(out(["[a|b|c]"]), {"a", "b", "c"})

    def test_array_is_sequential_over_seed(self):
        vals = [out(["[a|b|c]"], seed=s) for s in range(3)]
        self.assertEqual(set(vals), {"a", "b", "c"})  # a full rotation, no repeats

    def test_array_wraps(self):
        self.assertEqual(out(["[a|b|c]"], seed=0), out(["[a|b|c]"], seed=3))

    def test_counter_override(self):
        # An explicit Build-mode counter selects the index directly.
        content = "[a|b|c]"
        st = state([content])
        key = "s0|%s|0" % content
        st["counters"] = {key: 1}
        self.assertEqual(pb.resolve_prompt(st, 999)["output"], "b")


class WildcardTests(unittest.TestCase):
    def test_wildcard_picks_from_list(self):
        wc = {"color": ["red", "green", "blue"]}
        for seed in range(20):
            self.assertIn(out(["__color__"], seed=seed, wildcards=wc), {"red", "green", "blue"})

    def test_unknown_wildcard_preserved_and_warned(self):
        rec = pb.resolve_prompt(state(["__missing__"]), 0, wildcards={})
        self.assertEqual(rec["output"], "__missing__")
        self.assertTrue(any("missing" in w for w in rec["warnings"]))

    def test_wildcard_line_can_nest(self):
        wc = {"mood": ["{1::calm|0::wild}"]}
        self.assertEqual(out(["__mood__"], seed=1, wildcards=wc), "calm")


class PinTests(unittest.TestCase):
    def test_pin_overrides_roll(self):
        content = "{red|green|blue}"
        key = "s0|%s|0" % content
        for seed in range(20):
            self.assertEqual(out([content], seed=seed, pins={key: "teal"}), "teal")

    def test_pin_self_heals_on_edit(self):
        # A pin keyed to the old token text is ignored once the text changes.
        key = "s0|{red|green}|0"
        res = out(["{red|blue}"], seed=3, pins={key: "teal"})
        self.assertIn(res, {"red", "blue"})


class BuildRecordTests(unittest.TestCase):
    def test_record_shape(self):
        rec = pb.resolve_prompt(state([("Subject", "{a|b}"), ("Style", "photo")]), 0)
        self.assertEqual(set(rec), {"builtAt", "seed", "mode", "sections", "rolls", "output", "warnings"})
        self.assertEqual(len(rec["sections"]), 2)
        self.assertEqual(rec["sections"][1]["resolved"], "photo")
        self.assertEqual(len(rec["rolls"]), 1)
        self.assertEqual(rec["rolls"][0]["type"], "choice")

    def test_deterministic(self):
        st = state(["{a|b|c} {d|e|f} __w__", "[p|q|r]"])
        wc = {"w": ["x", "y", "z"]}
        a = pb.resolve_prompt(st, 42, wildcards=wc)
        b = pb.resolve_prompt(st, 42, wildcards=wc)
        self.assertEqual(a["output"], b["output"])
        self.assertEqual(a["rolls"], b["rolls"])

    def test_locked_mode_field_present(self):
        rec = pb.resolve_prompt(state(["hi"], mode="locked"), 0)
        self.assertEqual(rec["mode"], "locked")


class CoerceStateTests(unittest.TestCase):
    def test_accepts_json_string(self):
        import json

        s = json.dumps(state(["hello"]))
        self.assertEqual(pb.resolve_prompt(s, 0)["output"], "hello")

    def test_blank_is_empty(self):
        self.assertEqual(pb.resolve_prompt("", 0)["output"], "")

    def test_malformed_json_is_empty(self):
        self.assertEqual(pb.resolve_prompt("{not json", 0)["output"], "")


def choice(name, options, selected=None, mode="single", join=", "):
    """A choice def. ``options`` are (label, value) tuples or bare value strings;
    ids are assigned o0, o1, …  ``selected`` is an option id or list of ids (a
    bare string exercises the single-select back-compat path)."""
    opts = []
    for i, o in enumerate(options):
        label, value = o if isinstance(o, tuple) else (o, o)
        opts.append({"id": "o%d" % i, "label": label, "value": value})
    return {"id": name, "name": name, "mode": mode, "options": opts, "selected": selected, "join": join}


class ChoiceBlockTests(unittest.TestCase):
    def test_injects_selected_value(self):
        ch = choice("style", [("Cinematic", "cinematic, dramatic lighting"), ("Anime", "anime")], selected="o0")
        self.assertEqual(out(["a portrait, %style%"], choices=[ch]), "a portrait, cinematic, dramatic lighting")

    def test_label_differs_from_value(self):
        # the label is editor-only; the value is what lands in the prompt
        ch = choice("m", [("Pretty name", "the_value")], selected="o0")
        self.assertEqual(out(["%m%"], choices=[ch]), "the_value")

    def test_falls_back_to_first_option(self):
        ch = choice("style", [("A", "alpha"), ("B", "beta")], selected="nope")
        self.assertEqual(out(["%style%"], choices=[ch]), "alpha")
        ch2 = choice("style", [("A", "alpha")], selected=None)
        self.assertEqual(out(["%style%"], choices=[ch2]), "alpha")

    def test_variable_reused_across_references(self):
        # one value per build, reused — and only one roll is recorded for it
        ch = choice("x", [("A", "alpha")], selected="o0")
        rec = pb.resolve_prompt(state(["%x% and %x%"], choices=[ch]), 0)
        self.assertEqual(rec["output"], "alpha and alpha")
        var_rolls = [r for r in rec["rolls"] if r["type"] == "var"]
        self.assertEqual(len(var_rolls), 1)
        self.assertEqual(var_rolls[0]["source"], "choice")

    def test_unknown_choice_preserved_and_warned(self):
        rec = pb.resolve_prompt(state(["%missing%"]), 0)
        self.assertEqual(rec["output"], "%missing%")
        self.assertTrue(any("missing" in w for w in rec["warnings"]))

    def test_value_can_nest_tokens(self):
        # a choice value may itself contain wildcards, re-resolved after injection
        ch = choice("mood", [("M", "{1::calm|0::wild}")], selected="o0")
        self.assertEqual(out(["%mood%"], choices=[ch]), "calm")

    def test_empty_options_injects_blank(self):
        ch = choice("empty", [], selected=None)
        self.assertEqual(out(["x %empty% y"], choices=[ch]), "x  y")

    def test_bare_percent_is_literal(self):
        # % that doesn't form %name% is passed through untouched
        self.assertEqual(out(["50% off, 100% silk"]), "50% off, 100% silk")
        self.assertEqual(out(["%notclosed and %x"]), "%notclosed and %x")

    def test_selected_by_id_survives_reorder(self):
        # selection keys on option id, so it's stable if options are reordered
        ch = choice("s", [("A", "alpha"), ("B", "beta")], selected="o1")
        ch["options"] = list(reversed(ch["options"]))  # now [o1(beta), o0(alpha)]
        self.assertEqual(out(["%s%"], choices=[ch]), "beta")

    def test_scalar_selected_back_compat(self):
        # single-select once stored `selected` as a bare id string
        ch = choice("s", [("A", "alpha"), ("B", "beta")], selected="o1")
        self.assertEqual(out(["%s%"], choices=[ch]), "beta")

    def test_list_selected_single(self):
        ch = choice("s", [("A", "alpha"), ("B", "beta")], selected=["o1"])
        self.assertEqual(out(["%s%"], choices=[ch]), "beta")


class ChoiceMultiTests(unittest.TestCase):
    def test_joins_selected_in_option_order(self):
        # selected order is irrelevant; the options order is what's emitted
        ch = choice("t", [("A", "alpha"), ("B", "beta"), ("C", "gamma")], selected=["o2", "o0"], mode="multi")
        self.assertEqual(out(["%t%"], choices=[ch]), "alpha, gamma")

    def test_custom_join(self):
        ch = choice("t", [("A", "a"), ("B", "b")], selected=["o0", "o1"], mode="multi", join=" ")
        self.assertEqual(out(["%t%"], choices=[ch]), "a b")

    def test_none_selected_is_blank(self):
        ch = choice("t", [("A", "a")], selected=[], mode="multi")
        self.assertEqual(out(["x %t% y"], choices=[ch]), "x  y")

    def test_drops_empty_values(self):
        ch = choice("t", [("A", "alpha"), ("B", ""), ("C", "gamma")], selected=["o0", "o1", "o2"], mode="multi")
        self.assertEqual(out(["%t%"], choices=[ch]), "alpha, gamma")


class ChoiceRandomTests(unittest.TestCase):
    def test_picks_an_option_value(self):
        ch = choice("r", [("A", "alpha"), ("B", "beta"), ("C", "gamma")], mode="random")
        for seed in range(20):
            self.assertIn(out(["%r%"], seed=seed, choices=[ch]), {"alpha", "beta", "gamma"})

    def test_deterministic_for_seed(self):
        ch = choice("r", [("A", "alpha"), ("B", "beta"), ("C", "gamma")], mode="random")
        self.assertEqual(out(["%r%"], seed=5, choices=[ch]), out(["%r%"], seed=5, choices=[ch]))

    def test_varies_over_seeds(self):
        ch = choice("r", [("A", "a"), ("B", "b"), ("C", "c"), ("D", "d")], mode="random")
        self.assertGreater(len({out(["%r%"], seed=s, choices=[ch]) for s in range(20)}), 1)

    def test_reused_across_references(self):
        # a random choice is still a variable: one roll per build, reused everywhere
        ch = choice("r", [("A", "alpha"), ("B", "beta"), ("C", "gamma")], mode="random")
        rec = pb.resolve_prompt(state(["%r% / %r%"], choices=[ch]), 3)
        a, b = rec["output"].split(" / ")
        self.assertEqual(a, b)
        self.assertEqual(len([r for r in rec["rolls"] if r["type"] == "var"]), 1)


if __name__ == "__main__":
    unittest.main()
