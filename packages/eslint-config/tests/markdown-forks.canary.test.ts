import type { Linter } from 'eslint'

import { minCpuMs } from '@gpahal/internal/node/testing'

import { lintRun, problemsOf } from './markdown-fork-helpers'

// Each `@gpahal/markdown` rule forked from `@eslint/markdown` exists for the cases where the stock
// rule differs. These tests run the stock rule on those cases and fail once it no longer differs,
// so the fork may be removable

type Case = {
  name: string
  code: string
  stock: Array<string>
  fork: Array<string>
  languageOptions?: Linter.LanguageOptions
}

const CASES: Record<string, Array<Case>> = {
  'heading-increment': [
    {
      name: 'a title nested in YAML front matter',
      code: '---\nparams:\n  title: A\n---\n\n### B\n',
      languageOptions: { frontmatter: 'yaml' },
      stock: ['6:1'],
      fork: [],
    },
    {
      name: 'an HTML heading',
      code: '<h1>A</h1>\n\n### B\n',
      stock: [],
      fork: ['3:1'],
    },
  ],
  'no-multiple-h1': [
    {
      // A deliberate difference: `heading-increment` counts the same top-level titles
      name: 'a title nested in YAML front matter',
      code: '---\nmeta:\n  title: Nested\n---\n\n# Doc\n',
      languageOptions: { frontmatter: 'yaml' },
      stock: ['6:1'],
      fork: [],
    },
  ],
  'no-missing-label-refs': [
    {
      name: 'brackets in an autolink',
      code: '# T\n\n<https://x.y/[a]>\n',
      stock: ['3:15'],
      fork: [],
    },
  ],
  'no-missing-link-fragments': [
    {
      name: 'a link to a footnote',
      code: '# T\n\n[a](#fn-1)\n\nB[^1].\n\n[^1]: Note\n',
      stock: ['3:1'],
      fork: [],
    },
  ],
  'require-alt-text': [
    {
      name: 'an `<img>` in a `<textarea>`',
      code: '# T\n\n<textarea><img src="a"></textarea>\n',
      stock: ['3:11'],
      fork: [],
    },
  ],
  'no-missing-atx-heading-space': [
    { name: 'a tag', code: '# T\n\n#general\n', stock: ['3:1'], fork: [] },
  ],
}

const frontmatter = (spaces: number): string => `---\n${' '.repeat(spaces)}\n---\n\n# A\n`

describe('the fork of `no-multiple-h1`', () => {
  it('differs from the stock rule, which is quadratic on a front matter line of spaces, or `FRONTMATTER_TITLE` may be removable', () => {
    // Once this fails, `FRONTMATTER_TITLE` in src/internal/markdown/rules/utils.ts may go back to
    // the stock default. 4 times the spaces take 16 times as long in quadratic code; the fixed
    // cost of a lint lowers the ratio, measured at about 12
    const yaml: Linter.LanguageOptions = { frontmatter: 'yaml' }
    const [shortMs = 0, longMs = 0] = minCpuMs([
      lintRun('no-multiple-h1', frontmatter(3000), false, yaml),
      lintRun('no-multiple-h1', frontmatter(12_000), false, yaml),
    ])
    expect(longMs / shortMs).toBeGreaterThan(7)
  })
})

describe.each(Object.entries(CASES))('the fork of `%s`', (rule, cases) => {
  it.each(cases)(
    'differs from the stock rule on $name, or the fork may be removable',
    ({ code, stock, fork, languageOptions }) => {
      expect(problemsOf(rule, code, { isFork: true })).toEqual(fork)
      expect(problemsOf(rule, code, { languageOptions })).toEqual(stock)
    },
  )
})
