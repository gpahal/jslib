# /// script
# dependencies = ["fonttools[woff]==4.*"]
# ///
"""Writes poppins-regular-hmtx.woff2: poppins-regular.ttf as WOFF2 with its hmtx table transformed.

Run it with `uv run tests/fixtures/poppins-hmtx-woff2.py` from the package folder.
"""

from pathlib import Path

from fontTools.ttLib import woff2

FIXTURES_DIR = Path(__file__).parent

woff2.compress(
    str(FIXTURES_DIR / "poppins-regular.ttf"),
    str(FIXTURES_DIR / "poppins-regular-hmtx.woff2"),
    transform_tables={"glyf", "loca", "hmtx"},
)
