import markdown from '@eslint/markdown'
import { Linter } from 'eslint'

import { MARKDOWN_PLUGIN } from '@/internal/markdown/plugin'

// Each `@gpahal/markdown` rule forked from `@eslint/markdown` exists for the cases where the stock
// rule differs. These tests run the stock rule on those cases and fail once it no longer differs,
// so the fork may be removable

const linter = new Linter({ configType: 'flat' })

/**
 * The problems of `markdown/<rule>`, or of `@gpahal/markdown/<rule>` with `isFork`, on `code`, as
 * `line:column`. The stock rule runs on the stock language with `languageOptions`
 */
function problemsOf(
  rule: string,
  code: string,
  {
    isFork = false,
    languageOptions = {},
  }: { isFork?: boolean; languageOptions?: Linter.LanguageOptions | undefined } = {},
): Array<string> {
  const config: Linter.Config = isFork
    ? {
        files: ['**/*.md'],
        plugins: { '@gpahal/markdown': MARKDOWN_PLUGIN },
        language: '@gpahal/markdown/gfm',
        rules: { [`@gpahal/markdown/${rule}`]: 'error' },
      }
    : {
        files: ['**/*.md'],
        plugins: { markdown },
        language: 'markdown/gfm',
        languageOptions,
        rules: { [`markdown/${rule}`]: 'error' },
      }
  return linter
    .verify(code, config, 'doc.md')
    .map((message) => `${String(message.line)}:${String(message.column)}`)
}

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

describe.each(Object.entries(CASES))('the fork of `%s`', (rule, cases) => {
  it.each(cases)(
    'differs from the stock rule on $name, or the fork may be removable',
    ({ code, stock, fork, languageOptions }) => {
      expect(problemsOf(rule, code, { isFork: true })).toEqual(fork)
      expect(problemsOf(rule, code, { languageOptions })).toEqual(stock)
    },
  )
})
