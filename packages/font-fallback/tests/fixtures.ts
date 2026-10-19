import path from 'node:path'

export const FIXTURES_DIR = path.join(import.meta.dirname, 'fixtures')
/**
 * Figtree Regular from the Figtree repository, unchanged
 */
export const FIGTREE_PATH = path.join(FIXTURES_DIR, 'figtree-regular.ttf')
export const FIGTREE_WOFF2_PATH = path.join(FIXTURES_DIR, 'figtree-regular.woff2')
/**
 * Figtree's variable font from the Figtree repository, with one `wght` axis from 300 to 900 and a
 * default of 300
 */
export const VARIABLE_PATH = path.join(FIXTURES_DIR, 'figtree-variable.ttf')
/**
 * Figtree Regular with only space, a-z, A-Z and 0-9, made by `figtree-subsets.py`
 */
export const ALPHANUMERIC_PATH = path.join(FIXTURES_DIR, 'figtree-alphanumeric.ttf')
/**
 * A subset of Poppins SemiBold, of weight 600
 */
export const SEMIBOLD_PATH = path.join(FIXTURES_DIR, 'poppins-semibold.ttf')
/**
 * Poppins Regular as a WOFF2 font with a transformed `hmtx` table, made by `poppins-hmtx-woff2.py`
 */
export const HMTX_WOFF2_PATH = path.join(FIXTURES_DIR, 'poppins-regular-hmtx.woff2')
/**
 * KaTeX's `Extra` font: a CFF font of weight 200 with a few glyphs, whose family
 * `@capsizecss/metrics` doesn't have
 */
export const CFF_PATH = path.join(FIXTURES_DIR, 'katex-extra.otf')
/**
 * Figtree Regular's Latin glyphs as a CFF font, with a 6-byte `maxp` table, made by `figtree-cff.py`
 */
export const CFF_REGULAR_PATH = path.join(FIXTURES_DIR, 'figtree-regular-cff.otf')
