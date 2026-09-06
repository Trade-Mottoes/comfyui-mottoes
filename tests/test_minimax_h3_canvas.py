"""Unit tests for the MiniMax H3 Canvas node.

Run with either:
    python3 -m unittest tests.test_minimax_h3_canvas
    python3 -m pytest tests/test_minimax_h3_canvas.py

The node imports only `services/h3kit`, which is stdlib-only, so the file is loaded
directly and the package ``__init__`` (which imports ComfyUI) is bypassed — the same
trick the other node tests use.
"""

import importlib.util
import os
import sys
import unittest

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

# The node uses package-relative imports (`..services.h3kit`), so it needs a package to be
# relative TO. Register the two parents under throwaway names and load it as a submodule.
_PKG = "mottoes_under_test"
for name, path in ((_PKG, _ROOT), (f"{_PKG}.services", os.path.join(_ROOT, "services")),
                   (f"{_PKG}.nodes", os.path.join(_ROOT, "nodes"))):
    spec = importlib.util.spec_from_file_location(
        name, os.path.join(path, "__init__.py"),
        submodule_search_locations=[path])
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    if name != _PKG:                      # the root __init__ imports ComfyUI; skip it
        spec.loader.exec_module(module)

_spec = importlib.util.spec_from_file_location(
    f"{_PKG}.nodes.minimax_h3", os.path.join(_ROOT, "nodes", "minimax_h3.py"))
h3 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(h3)

NODE = h3.MiniMaxH3Canvas()


def derive(aspect="16:9", megapixels=1.032, seconds=15.0):
    return NODE.derive(aspect, megapixels, seconds)


class CanvasTests(unittest.TestCase):
    def test_the_default_is_h3s_own_trained_canvas(self):
        width, height, *_ = derive()
        self.assertEqual((width, height), (1344, 768))

    def test_every_axis_lands_on_a_multiple_of_32(self):
        for aspect in ("16:9", "9:16", "2:3", "1:1", "21:9"):
            for mp in (0.2, 0.4, 1.032, 1.6):
                width, height, *_ = derive(aspect, mp)
                with self.subTest(aspect=aspect, megapixels=mp):
                    self.assertEqual((width % 32, height % 32), (0, 0))

    def test_the_area_follows_the_megapixels(self):
        small, big = derive(megapixels=0.2), derive(megapixels=1.6)
        self.assertLess(small[0] * small[1], big[0] * big[1])

    def test_orientation_follows_the_aspect(self):
        self.assertGreater(derive("16:9")[0], derive("16:9")[1])
        self.assertLess(derive("9:16")[0], derive("9:16")[1])

    def test_the_separators_parse_alike(self):
        self.assertEqual(derive("16:9")[:2], derive("16x9")[:2])
        self.assertEqual(derive("16:9")[:2], derive("16/9")[:2])


class FrameCountTests(unittest.TestCase):
    def test_the_frame_count_is_legal(self):
        for seconds in (0.2, 1.0, 5.0, 14.375, 15.0, 30.0):
            length = derive(seconds=seconds)[2]
            with self.subTest(seconds=seconds):
                self.assertEqual(length % 17, 5)

    def test_a_duration_is_a_ceiling_and_rounds_up(self):
        """Up, matching the model's own align_frame_count. Rounding down would quietly
        deliver less than was asked for."""
        self.assertEqual(derive(seconds=14.375)[2], 345)     # 345 = 14.375 * 24 exactly
        self.assertEqual(derive(seconds=14.30)[2], 345)      # rounds up to the same
        self.assertEqual(derive(seconds=14.40)[2], 362)      # over 345 -> the next one up

    def test_the_seconds_output_says_what_you_actually_got(self):
        *_, seconds = derive(seconds=14.30)
        self.assertAlmostEqual(seconds, 345 / 24, places=6)
        self.assertGreater(seconds, 14.30)

    def test_fps_is_h3s_own(self):
        self.assertEqual(derive()[3], 24.0)

    def test_nothing_is_clamped_to_the_trained_range(self):
        """Outside it is legal and out of distribution — something to be told about by a
        validator that knows the clip, not silently prevented here."""
        self.assertGreater(derive(seconds=40.0)[2], h3.TRAINED_RANGE[1])
        self.assertLess(derive(seconds=1.0)[2], h3.TRAINED_RANGE[0])


class ValidationTests(unittest.TestCase):
    def test_a_bad_aspect_is_named_before_the_models_load(self):
        result = h3.MiniMaxH3Canvas.VALIDATE_INPUTS(aspect_ratio="16-9")
        self.assertIsInstance(result, str)
        self.assertIn("16-9", result)

    def test_a_non_positive_area_or_duration_is_refused(self):
        self.assertIsInstance(h3.MiniMaxH3Canvas.VALIDATE_INPUTS(megapixels=0), str)
        self.assertIsInstance(h3.MiniMaxH3Canvas.VALIDATE_INPUTS(seconds=0), str)

    def test_a_good_set_of_inputs_validates(self):
        self.assertIs(h3.MiniMaxH3Canvas.VALIDATE_INPUTS("21:9", 0.4, 8.0), True)

    def test_execution_raises_rather_than_inventing_a_canvas(self):
        with self.assertRaises(ValueError):
            derive(aspect="sixteen by nine")


class ContractTests(unittest.TestCase):
    def test_the_outputs_are_named_and_described_one_for_one(self):
        cls = h3.MiniMaxH3Canvas
        self.assertEqual(len(cls.RETURN_TYPES), len(cls.RETURN_NAMES))
        self.assertEqual(len(cls.RETURN_TYPES), len(cls.OUTPUT_TOOLTIPS))
        self.assertEqual(len(derive()), len(cls.RETURN_TYPES))

    def test_width_height_and_length_are_ints(self):
        width, height, length, fps, seconds = derive()
        for value in (width, height, length):
            self.assertIsInstance(value, int)
        for value in (fps, seconds):
            self.assertIsInstance(value, float)


if __name__ == "__main__":
    unittest.main()
