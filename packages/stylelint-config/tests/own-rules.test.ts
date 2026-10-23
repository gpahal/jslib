import fs from 'node:fs/promises'
import path from 'node:path'

import stylelint from 'stylelint'
import type { Plugin } from 'stylelint'

import { commentLayout } from '@/internal/comment-layout'
import { customPropertyEmptyLineBefore } from '@/internal/custom-property-empty-line-before'
import { declarationEmptyLineBefore } from '@/internal/declaration-empty-line-before'
import { mediaRangeSpacing } from '@/internal/media-range-spacing'
import { quoteRules } from '@/internal/quote-rules'
import { tailwindApply } from '@/internal/tailwind-apply'
import { tailwindDirectives } from '@/internal/tailwind-directives'
import { tailwindThemeFunction } from '@/internal/tailwind-theme-function'

import { fix } from './helpers'

/**
 * The name and the docs URL of each own rule
 */
const OWN_RULES = [
  commentLayout,
  customPropertyEmptyLineBefore,
  declarationEmptyLineBefore,
  mediaRangeSpacing,
  tailwindApply(undefined),
  tailwindDirectives,
  tailwindThemeFunction,
  ...quoteRules,
].map((plugin: Plugin) => {
  const { ruleName, rule } = 'rule' in plugin ? plugin : plugin.default!
  return [ruleName, rule.meta?.url ?? ''] as const
})

/**
 * The fragment of a heading's link, as GitHub writes it
 */
function slugOf(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}\s_-]/gu, '')
    .replaceAll(/\s/gu, '-')
}

describe('own rules', () => {
  it.each(OWN_RULES)(
    "%s's docs URL links to a heading of the package README",
    async (_name, url) => {
      const readme = await fs.readFile(path.join(import.meta.dirname, '../README.md'), 'utf8')
      const slugs = readme
        .split('\n')
        .filter((line) => /^#{1,6} /.test(line))
        .map((line) => slugOf(line.replace(/^#+ /, '')))
      expect(url).toMatch(
        /^https:\/\/github\.com\/gpahal\/jslib\/tree\/main\/packages\/stylelint-config#/,
      )
      expect(slugs).toContain(url.split('#', 2)[1])
    },
  )
})

const [fontFamilyNameQuotes, functionUrlQuotes, importNotation] = quoteRules as [
  Plugin,
  Plugin,
  Plugin,
]

/**
 * Code with problems of each own rule, each in a node of its own, since Stylelint gives only the
 * first fix of overlapping nodes an edit, and the number of warnings it gets
 */
const FIXABLE_CASES: ReadonlyArray<readonly [string, Plugin, unknown, string, number]> = [
  [
    'unquoted font family names',
    fontFamilyNameQuotes,
    'always-unless-keyword',
    'a {\n  font-family: Helvetica, serif;\n}\n\nb {\n  font-family: Arial, serif;\n}\n',
    2,
  ],
  [
    'unquoted URLs',
    functionUrlQuotes,
    'always',
    'a {\n  background: url(a.png);\n}\n\nb {\n  background: url(b.png);\n}\n',
    2,
  ],
  ['URL imports', importNotation, 'string', '@import url(a.css);\n@import url(b.css);\n', 2],
  [
    'comments in the root',
    commentLayout,
    true,
    '/* One\n   two. */\na {}\n/* Three\n   four. */\nb {}',
    2,
  ],
  [
    'declarations after empty lines',
    declarationEmptyLineBefore,
    'never',
    'a {\n  color: red;\n\n  top: 0;\n}\n\nb {\n  color: red;\n\n  top: 0;\n}\n',
    2,
  ],
  [
    'custom properties without an empty line',
    customPropertyEmptyLineBefore,
    'always',
    'a {\n  color: red;\n  --x: 1;\n}\n\nb {\n  color: red;\n  --y: 1;\n}\n',
    2,
  ],
  // One warning for each at-rule, whatever its number of comparisons
  [
    'unspaced range comparisons',
    mediaRangeSpacing,
    true,
    '@media (400px<width<=700px) and (height>10em) {\n  a {\n    color: red;\n  }\n}\n\n@container (height<10rem) {\n  a {\n    color: red;\n  }\n}\n',
    2,
  ],
]

describe('own rules with computeEditInfo', () => {
  it.each(FIXABLE_CASES)(
    'gives every warning an edit that --fix agrees with, for %s',
    async (_case, plugin, setting, code, count) => {
      const { ruleName } = 'rule' in plugin ? plugin : plugin.default!
      const config = { plugins: [plugin], rules: { [ruleName]: setting } }
      const { results } = await stylelint.lint({ code, config, computeEditInfo: true })
      const warnings = results.flatMap((result) => result.warnings)
      expect(warnings).toHaveLength(count)
      for (const warning of warnings) {
        expect(warning.fix, warning.text).toBeDefined()
      }
      // The edits don't overlap, so applying them from the last keeps the earlier ranges
      const edits = warnings
        .map((warning) => warning.fix!)
        .toSorted((a, b) => b.range[0] - a.range[0])
      const edited = edits.reduce(
        (text, edit) => text.slice(0, edit.range[0]) + edit.text + text.slice(edit.range[1]),
        code,
      )
      expect(edited).toBe(await fix(code, config))
    },
  )
})

describe.each([
  ['@gpahal/comment-layout', commentLayout],
  ['@gpahal/media-range-spacing', mediaRangeSpacing],
] as const)('%s options', (ruleName, plugin) => {
  it('reports an invalid primary option', async () => {
    const primary = 'true'
    const { errored, results } = await stylelint.lint({
      code: 'a {}',
      config: { plugins: [plugin], rules: { [ruleName]: primary } },
    })
    expect(errored).toBe(true)
    expect(results[0]?.invalidOptionWarnings).toEqual([
      expect.objectContaining({ text: expect.stringContaining(ruleName) as unknown }),
    ])
  })
})
