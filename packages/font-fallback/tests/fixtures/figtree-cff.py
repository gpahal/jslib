# /// script
# dependencies = ["fonttools==4.*"]
# ///
"""Writes figtree-regular-cff.otf: figtree-regular.ttf subset to Basic Latin and Latin-1, with its
outlines converted to CFF, so it has a 6-byte version 0.5 `maxp` table.

Run it with `uv run tests/fixtures/figtree-cff.py` from the package folder.
"""

from pathlib import Path

from fontTools import subset
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.ttLib import TTFont

FIXTURES_DIR = Path(__file__).parent

font = TTFont(FIXTURES_DIR / "figtree-regular.ttf", recalcTimestamp=False)
subsetter = subset.Subsetter(subset.Options(name_IDs=["*"], layout_features=[], hinting=False))
subsetter.populate(unicodes=[*range(0x20, 0x7F), *range(0xA0, 0x100)])
subsetter.subset(font)

glyph_set = font.getGlyphSet()
char_strings = {}
for name in font.getGlyphOrder():
    pen = T2CharStringPen(font["hmtx"][name][0], glyph_set)
    glyph_set[name].draw(pen)
    char_strings[name] = pen.getCharString()

for tag in ["glyf", "loca", "gasp", "cvt ", "fpgm", "prep"]:
    if tag in font:
        del font[tag]
font.sfntVersion = "OTTO"
font["maxp"].tableVersion = 0x00005000

builder = FontBuilder(font=font, isTTF=False)
builder.setupCFF("Figtree-Regular", {"FullName": "Figtree Regular"}, char_strings, {})
font.save(FIXTURES_DIR / "figtree-regular-cff.otf")
