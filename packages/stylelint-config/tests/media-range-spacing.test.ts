import process from 'node:process'

import * as prettier from 'prettier'

import { defineConfig } from '@/index'
import { mediaRangeSpacing } from '@/internal/media-range-spacing'

import { fix, lintRules } from './helpers'

const baseConfig = await defineConfig({ root: process.cwd() })

/**
 * The rule alone, so other rules' reports don't mix in
 */
const config = { plugins: [mediaRangeSpacing], rules: { '@gpahal/media-range-spacing': true } }

test.each([
  ['@media (width <=1023.98px) {}', '@media (width <= 1023.98px) {}'],
  [
    '@media (400px<width<=700px) and (height>10em) {}',
    '@media (400px < width <= 700px) and (height > 10em) {}',
  ],
  // Several comparisons, with `style()` between them left alone
  [
    '@container card (inline-size>30em) and style(--x: a>b) and (block-size<=20em) {}',
    '@container card (inline-size > 30em) and style(--x: a>b) and (block-size <= 20em) {}',
  ],
  // The media query of an `@import`, after its `supports()` condition
  [
    '@import url(a.css) supports(selector(a>b)) (width>600px);',
    '@import url(a.css) supports(selector(a>b)) (width > 600px);',
  ],
  // The at-rules of Tailwind's `@custom-variant` shorthand, but not its selectors
  [
    '@custom-variant sm (&:where(.a>b), @media (width>=40rem));',
    '@custom-variant sm (&:where(.a>b), @media (width >= 40rem));',
  ],
])('fixes %s', async (css, expected) => {
  expect(await lintRules(css, config)).not.toEqual([])
  expect(await fix(css, config)).toBe(expected)
  expect(await lintRules(expected, config)).toEqual([])
})

test.each([
  '@media (width >= 640px) {}',
  // Outside parentheses, in strings and in `url()`
  '@media screen>print {}',
  // `style()` queries hold values, not comparisons
  '@container style(--label: a>b) {}',
  // Invalid operators, which spacing would turn into different, valid ones
  '@media (width=>600px) {}',
  // An escaped `\)` doesn't end the URL, and a later `\(` doesn't open a query
  String.raw`@import url(a\)b\(x=1.css);`,
  // Escaped operator characters and parentheses are part of an identifier
  String.raw`@media (--a\(b) {}`,
])('accepts %s', async (css) => {
  expect(await lintRules(css, config)).toEqual([])
  expect(await fix(css, config)).toBe(css)
})

/**
 * `fn`'s result, and how many code units its calls of `String.prototype.slice` copied in all
 */
async function countSlicedCodeUnits<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; codeUnits: number }> {
  const slice = vi.spyOn(String.prototype, 'slice')
  try {
    const result = await fn()
    // Read before `mockRestore`, which clears the results
    const codeUnits = slice.mock.results.reduce(
      (sum, { value }: { value: unknown }) => sum + (typeof value === 'string' ? value.length : 0),
      0,
    )
    return { result, codeUnits }
  } finally {
    slice.mockRestore()
  }
}

test('reads and fixes a long prelude in one pass', async () => {
  // Fixing each comparison by rewriting the whole prelude copies it once per comparison
  const comparisons = Array.from({ length: 2000 }, () => '(width>1px)')
  const css = `@media ${comparisons.join(' and ')} {}`
  const { result, codeUnits } = await countSlicedCodeUnits(async () => fix(css, config))
  expect(result).toBe(`@media ${comparisons.join(' and ').replaceAll('>', ' > ')} {}`)
  expect(codeUnits).toBeLessThan(5 * css.length)
})

test("spaces media-feature-range-notation's fix in the same --fix pass, and Prettier keeps it", async () => {
  const body = ' {\n  a {\n    color: red;\n  }\n}\n'
  const fixed = await fix(`@media (max-width:1023.98px)${body}`, baseConfig)
  expect(fixed).toBe(`@media (width <= 1023.98px)${body}`)
  expect(await prettier.format(fixed, { parser: 'css' })).toBe(fixed)
})

test('skips a prelude with a comment inside, whose text a fix would drop', async () => {
  expect(await lintRules('@media (width>1px) /* Wide */ and (height>1px) {}', config)).toEqual([])
})
