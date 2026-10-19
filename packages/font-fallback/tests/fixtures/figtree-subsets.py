# /// script
# dependencies = ["fonttools==4.*"]
# ///
"""Writes figtree-alphanumeric.ttf: a subset of figtree-regular.ttf with only space, a-z, A-Z and
0-9.

Run it with `uv run tests/fixtures/figtree-subsets.py` from the package folder.
"""

import string
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

FIXTURES_DIR = Path(__file__).parent

font = TTFont(FIXTURES_DIR / "figtree-regular.ttf")
subsetter = subset.Subsetter(subset.Options(name_IDs=["*"], layout_features=[]))
subsetter.populate(
    unicodes=[ord(character) for character in " " + string.ascii_letters + string.digits]
)
subsetter.subset(font)
font.save(FIXTURES_DIR / "figtree-alphanumeric.ttf")
